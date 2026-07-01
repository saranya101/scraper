import { prisma } from "../repositories/prisma.js";
import { notFound } from "../utils/httpError.js";
import {
  getOutreachAutomationSettings,
  getSendUsage,
  saveOutreachAutomationSettings,
  updateOutreachAutomationSettings
} from "./automationGuards.service.js";
import {
  getAutomationDashboardData,
  processAutomationFollowUps,
  processAutomationLeads,
  syncRepliesAutomation
} from "./automationWorkflow.service.js";
import { getAutomationJob as getStoredAutomationJob, listAutomationJobs } from "./automationJobs.service.js";
import * as scannerService from "./scannerService.js";

const runningSchedules = new Set();
const backgroundUserRuns = new Map();
let schedulerTimer = null;

function nextRunDate(frequency, from = new Date()) {
  const next = new Date(from);
  next.setSeconds(0, 0);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + 7);
  else next.setDate(next.getDate() + 1);
  return next;
}

function templateToScanInput(template) {
  const filters = template.filters && typeof template.filters === "object" ? template.filters : {};
  return {
    ...filters,
    keyword: filters.keyword || template.keyword,
    location: filters.location || template.location,
    country: filters.country || undefined,
    state: filters.state || undefined,
    city: filters.city || undefined,
    maxResults: Number(filters.maxResults || template.maxResults || 10),
    scanDepth: filters.scanDepth || "QUICK",
    minReviews: filters.minReviews === "" || filters.minReviews == null ? undefined : Number(filters.minReviews),
    hasWebsiteOnly: filters.hasWebsiteOnly == null ? true : Boolean(filters.hasWebsiteOnly),
    filters: {
      industrySlug: filters.industrySlug,
      includeKeywords: filters.includeKeywords,
      excludeKeywords: filters.excludeKeywords,
      minimumScore: filters.minimumScore ? Number(filters.minimumScore) : undefined,
      priority: filters.priority,
      websiteStatus: filters.websiteStatus
    }
  };
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function parsePipelineValue(value) {
  const numbers = String(value || "").match(/\d[\d,]*/g)?.map((item) => Number(item.replaceAll(",", ""))) || [];
  return numbers.length ? Math.max(...numbers) : 0;
}

function runtimeMinutes(job) {
  if (!job.startedAt || !job.completedAt) return null;
  const minutes = (new Date(job.completedAt) - new Date(job.startedAt)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

function stageFromJob(job) {
  if (!job) return "Scheduled";
  if (job.status === "QUEUED" || job.status === "PENDING") return "Scheduled";
  if (job.status === "FAILED") return "Scan failed";
  if (job.status === "COMPLETED") return "Imported";
  const messages = (Array.isArray(job.logs) ? job.logs : []).map((log) => String(log.message || "").toLowerCase());
  if (messages.some((message) => message.includes("scan completed"))) return "Imported";
  if (messages.some((message) => message.includes("generated") || message.includes("outreach"))) return "Outreach Generated";
  if (messages.some((message) => message.includes("service opportunities") || message.includes("rank"))) return "Ranking";
  if (messages.some((message) => message.includes("ai audit") || message.includes("audit failed"))) return "AI Audit";
  if (messages.some((message) => message.includes("screenshot"))) return "Screenshotting";
  if (messages.some((message) => message.includes("checking") || message.includes("visiting"))) return "Visiting Websites";
  if (messages.some((message) => message.includes("searching") || message.includes("found"))) return "Scanning";
  return "Scanning";
}

function scheduleIndustry(schedule) {
  const filters = schedule.template?.filters && typeof schedule.template.filters === "object" ? schedule.template.filters : {};
  return filters.industryName || filters.industrySlug || schedule.template?.keyword || "Unknown";
}

function automationWarnings(settings) {
  const warnings = [];
  if (settings.mode === "FULL_AUTOMATION") {
    warnings.push("Full automation will send emails without manual review if safety gates pass.");
  }
  if (settings.autoSendInitialEmailsEnabled && settings.requireManualApprovalBeforeInitialSend === false) {
    warnings.push("Initial auto-send is enabled. Check Gmail connection, send limits, and quality gates.");
  }
  if (settings.autoSendFollowUpsEnabled && settings.requireManualApprovalBeforeFollowUpSend === false) {
    warnings.push("Follow-up auto-send is enabled. Replied, bounced, and do-not-contact leads will still be skipped.");
  }
  return warnings;
}

async function userSchedules(userId) {
  return prisma.automationSchedule.findMany({
    where: { createdBy: userId },
    include: { template: true, _count: { select: { notifications: true } } },
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }, { createdAt: "desc" }]
  });
}

async function jobsForSchedules(schedules, userId) {
  const keywords = [...new Set(schedules.map((schedule) => schedule.template?.keyword).filter(Boolean))];
  if (!keywords.length) return [];
  return prisma.scanJob.findMany({
    where: { createdBy: userId, keyword: { in: keywords } },
    include: { results: true },
    orderBy: { createdAt: "desc" }
  });
}

function jobsForSchedule(schedule, jobs) {
  return jobs.filter((job) => job.keyword === schedule.template?.keyword);
}

async function notify({ scheduleId, userId, type = "INFO", title, message }) {
  return prisma.automationNotification.create({
    data: { scheduleId, createdBy: userId, type, title, message }
  });
}

function shouldRunBackground(kind, settings, lastRun) {
  if (settings.automationPaused) return false;
  const now = Date.now();
  if (kind === "lead_processing") {
    if (!(settings.autoAnalyzeLeadsEnabled || settings.autoAnalyzeServicesEnabled || settings.autoRunPipelineEnabled || settings.autoGenerateReportsEnabled || settings.autoGenerateEmailsEnabled || settings.autoSendInitialEmailsEnabled)) {
      return false;
    }
    return !lastRun || now - lastRun >= 15 * 60 * 1000;
  }
  if (kind === "reply_sync") {
    if (!settings.autoSyncRepliesEnabled) return false;
    return !lastRun || now - lastRun >= 5 * 60 * 1000;
  }
  if (kind === "follow_ups") {
    if (!(settings.autoGenerateFollowUpsEnabled || settings.autoSendFollowUpsEnabled)) return false;
    return !lastRun || now - lastRun >= 30 * 60 * 1000;
  }
  return false;
}

async function processBackgroundAutomation() {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) {
    const state = backgroundUserRuns.get(user.id) || {};
    if (state.running) continue;
    state.running = true;
    backgroundUserRuns.set(user.id, state);
    try {
      const settings = await getOutreachAutomationSettings();
      if (shouldRunBackground("lead_processing", settings, state.leadProcessingAt)) {
        await processAutomationLeads(user.id, {});
        state.leadProcessingAt = Date.now();
      }
      if (shouldRunBackground("reply_sync", settings, state.replySyncAt)) {
        await syncRepliesAutomation(user.id);
        state.replySyncAt = Date.now();
      }
      if (shouldRunBackground("follow_ups", settings, state.followUpsAt)) {
        await processAutomationFollowUps(user.id);
        state.followUpsAt = Date.now();
      }
    } catch (error) {
      console.error("Background outreach automation failed:", error.message || error);
    } finally {
      state.running = false;
      backgroundUserRuns.set(user.id, state);
    }
  }
}

async function scheduleWithTemplate(id) {
  const schedule = await prisma.automationSchedule.findUnique({
    where: { id },
    include: { template: true, user: { select: { id: true, name: true, email: true } } }
  });
  if (!schedule) throw notFound("Automation schedule not found");
  return schedule;
}

export async function listSchedules(userId) {
  const schedules = await userSchedules(userId);
  const jobs = await jobsForSchedules(schedules, userId);
  return schedules.map((schedule) => {
    const scheduleJobs = jobsForSchedule(schedule, jobs);
    const latestJob = scheduleJobs[0] || null;
    return {
      ...schedule,
      currentStage: stageFromJob(latestJob),
      latestRun: latestJob
        ? {
            id: latestJob.id,
            status: latestJob.status,
            progress: latestJob.progress,
            progressPercent: latestJob.progressPercent || latestJob.progress,
            currentStage: latestJob.currentStage,
            currentUrl: latestJob.currentUrl,
            totalItems: latestJob.totalItems,
            completedItems: latestJob.completedItems,
            failedItems: latestJob.failedItems,
            logs: Array.isArray(latestJob.logs) ? latestJob.logs.slice(-8) : [],
            createdAt: latestJob.createdAt,
            startedAt: latestJob.startedAt,
            completedAt: latestJob.completedAt,
            results: latestJob.results.length
          }
        : null
    };
  });
}

export async function createSchedule(input, userId) {
  const template = await prisma.scanTemplate.findFirst({ where: { id: input.templateId, createdBy: userId } });
  if (!template) throw notFound("Scan template not found");
  const frequency = input.frequency || "DAILY";
  const schedule = await prisma.automationSchedule.create({
    data: {
      name: input.name,
      templateId: input.templateId,
      frequency,
      enabled: input.enabled == null ? true : Boolean(input.enabled),
      nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : nextRunDate(frequency),
      createdBy: userId
    },
    include: { template: true }
  });
  await notify({
    scheduleId: schedule.id,
    userId,
    title: "Automation schedule created",
    message: `${schedule.name} will run ${frequency.toLowerCase()}.`
  });
  return schedule;
}

export async function updateSchedule(id, input, userId) {
  await scheduleWithTemplate(id);
  const data = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(input.frequency ? { frequency: input.frequency } : {}),
    ...(input.enabled == null ? {} : { enabled: Boolean(input.enabled) }),
    ...(Object.prototype.hasOwnProperty.call(input, "nextRunAt") ? { nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : null } : {})
  };
  if (input.templateId) {
    const template = await prisma.scanTemplate.findFirst({ where: { id: input.templateId, createdBy: userId } });
    if (!template) throw notFound("Scan template not found");
  }
  const schedule = await prisma.automationSchedule.update({
    where: { id },
    data,
    include: { template: true }
  });
  await notify({
    scheduleId: id,
    userId,
    title: "Automation schedule updated",
    message: `${schedule.name} is now ${schedule.enabled ? "enabled" : "disabled"}.`
  });
  return schedule;
}

export async function pauseSchedule(id, userId) {
  const schedule = await updateSchedule(id, { enabled: false }, userId);
  await notify({
    scheduleId: id,
    userId,
    title: "Automation paused",
    message: `${schedule.name} has been paused.`
  });
  return schedule;
}

export async function finishSchedule(id, userId) {
  const schedule = await prisma.automationSchedule.update({
    where: { id },
    data: { enabled: false, nextRunAt: null },
    include: { template: true }
  });
  await notify({
    scheduleId: id,
    userId,
    type: "SUCCESS",
    title: "Automation completed",
    message: `${schedule.name} has been marked finished.`
  });
  return schedule;
}

export async function deleteSchedule(id) {
  await scheduleWithTemplate(id);
  await prisma.automationSchedule.delete({ where: { id } });
}

export async function runSchedule(id, userId, source = "manual") {
  if (runningSchedules.has(id)) return { message: "Schedule is already running", scheduleId: id };
  runningSchedules.add(id);
  try {
    const schedule = await scheduleWithTemplate(id);
    const scanInput = templateToScanInput(schedule.template);
    const job = await scannerService.runScan(scanInput, schedule.createdBy);
    await prisma.automationRun.create({
      data: {
        scheduleId: id,
        scanJobId: job.id,
        currentStage: job.currentStage || "Queued",
        progressPercent: job.progressPercent || job.progress || 0,
        totalItems: job.totalItems || 0,
        completedItems: job.completedItems || 0,
        failedItems: job.failedItems || 0,
        currentUrl: job.currentUrl || null,
        logs: job.logs || []
      }
    }).catch(() => {});
    const nextRunAt = schedule.enabled ? nextRunDate(schedule.frequency) : schedule.nextRunAt;
    await prisma.automationSchedule.update({
      where: { id },
      data: { lastRunAt: new Date(), nextRunAt }
    });
    await notify({
      scheduleId: id,
      userId: userId || schedule.createdBy,
      type: "SUCCESS",
      title: source === "scheduled" ? "Scheduled scan queued" : "Automation run queued",
      message: `${schedule.name} queued scan ${job.id}. Results will appear in Scanner and Leads.`
    });
    return { message: "Automation run queued", scheduleId: id, scanJob: job };
  } catch (error) {
    const schedule = await prisma.automationSchedule.findUnique({ where: { id } }).catch(() => null);
    await notify({
      scheduleId: id,
      userId: userId || schedule?.createdBy,
      type: "ERROR",
      title: "Automation failed",
      message: error.message
    }).catch(() => {});
    throw error;
  } finally {
    runningSchedules.delete(id);
  }
}

export async function getRunProgress(id, userId) {
  const run = await prisma.automationRun.findUnique({
    where: { id },
    include: { schedule: true }
  }).catch(() => null);
  if (run) {
    if (run.schedule.createdBy !== userId) throw notFound("Automation run not found");
    if (run.scanJobId) return scannerService.getScanProgress(run.scanJobId);
    return run;
  }
  return scannerService.getScanProgress(id);
}

export async function getDashboard(userId) {
  const schedules = await userSchedules(userId);
  const jobs = await jobsForSchedules(schedules, userId);
  const today = startOfToday();
  const todayJobs = jobs.filter((job) => new Date(job.createdAt) >= today);
  const completed = jobs.filter((job) => job.status === "COMPLETED").length;
  const failed = jobs.filter((job) => job.status === "FAILED").length;
  const runtimes = jobs.map(runtimeMinutes).filter((value) => value != null);
  const todayResults = todayJobs.flatMap((job) => job.results || []);
  const [settings, sendUsage, needsActionCount, followUpsDueCount, repliedCount, bouncedCount, doNotContactCount, workflowMetrics] = await Promise.all([
    getOutreachAutomationSettings(),
    getSendUsage(userId),
    prisma.lead.count({ where: { needsAction: true } }),
    prisma.lead.count({
      where: {
        nextFollowUpAt: { lte: new Date() },
        followUpStatus: { in: ["SCHEDULED", "FOLLOW_UP_1_SENT"] },
        repliedAt: null,
        doNotContact: false,
        bouncedAt: null
      }
    }),
    prisma.lead.count({
      where: {
        OR: [{ repliedAt: { not: null } }, { emailStatus: "REPLIED" }, { pipelineStage: "REPLIED" }]
      }
    }),
    prisma.lead.count({
      where: {
        OR: [{ bouncedAt: { not: null } }, { emailStatus: "BOUNCED" }, { pipelineStage: "BOUNCED" }]
      }
    }),
    prisma.lead.count({ where: { doNotContact: true } }),
    getAutomationDashboardData(userId)
  ]);

  return {
    activeSchedules: schedules.filter((schedule) => schedule.enabled).length,
    runsToday: todayJobs.length,
    successRate: completed + failed ? Math.round((completed / (completed + failed)) * 100) : 0,
    avgRuntime: runtimes.length ? Math.round((runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length) * 10) / 10 : 0,
    leadsGeneratedToday: todayResults.filter((result) => result.imported).length,
    automationMode: settings.mode,
    automationPaused: settings.automationPaused,
    automationPausedReason: settings.automationPausedReason,
    sendWindow: {
      start: settings.sendWindowStart,
      end: settings.sendWindowEnd,
      timezone: settings.sendTimezone
    },
    sendUsage,
    needsActionCount,
    followUpsDueCount,
    repliedCount,
    bouncedCount,
    doNotContactCount,
    reportsGenerated: workflowMetrics.reportsGenerated,
    reportsApproved: workflowMetrics.reportsApproved,
    emailsGenerated: workflowMetrics.emailsGenerated,
    emailsSent: workflowMetrics.emailsSent,
    interestedReplies: workflowMetrics.interestedReplies,
    followUpsSent: workflowMetrics.followUpsSent,
    failedLeads: workflowMetrics.failedLeads,
    warnings: automationWarnings(settings),
    notificationTypes: [
      "Hot lead found",
      "Scan failed",
      "Automation completed",
      "High-value lead found",
      "Reply received",
      "Meeting booked"
    ]
  };
}

export async function getPerformance(userId) {
  const schedules = await userSchedules(userId);
  const jobs = await jobsForSchedules(schedules, userId);
  return schedules.map((schedule) => {
    const scheduleJobs = jobsForSchedule(schedule, jobs);
    const results = scheduleJobs.flatMap((job) => job.results || []);
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      industry: scheduleIndustry(schedule),
      runs: scheduleJobs.length,
      leadsFound: results.length,
      hotLeads: results.filter((result) => result.priority === "HOT").length,
      failures: scheduleJobs.filter((job) => job.status === "FAILED").length + results.filter((result) => result.accessIssue || result.websiteStatus !== "WORKING").length,
      estimatedPipeline: results.reduce((sum, result) => sum + parsePipelineValue(result.estimatedProjectValue), 0)
    };
  });
}

export async function getDiagnostics(userId) {
  const schedules = await userSchedules(userId);
  const jobs = await jobsForSchedules(schedules, userId);
  const results = jobs.flatMap((job) => job.results || []);
  const jobLogs = jobs.flatMap((job) => (Array.isArray(job.logs) ? job.logs : []).map((log) => String(log.message || "").toLowerCase()));
  return {
    cloudflare: results.filter((result) => result.websiteStatus === "CLOUDFLARE" || /cloudflare/i.test(result.accessIssueReason || "")).length,
    timeout: results.filter((result) => result.websiteStatus === "TIMEOUT" || /timeout/i.test(result.accessIssueReason || "")).length,
    noWebsite: results.filter((result) => result.websiteStatus === "NO_WEBSITE" || !result.website).length,
    openAiFailed: results.filter((result) => /ai audit failed|openai/i.test(`${JSON.stringify(result.issues || [])} ${result.accessIssueReason || ""}`)).length + jobLogs.filter((message) => message.includes("ai audit failed")).length,
    screenshotFailed: results.filter((result) => /screenshot/i.test(`${JSON.stringify(result.issues || [])} ${result.accessIssueReason || ""}`) && !result.screenshotPath).length + jobLogs.filter((message) => message.includes("screenshot") && message.includes("failed")).length,
    googlePlacesFailed: jobLogs.filter((message) => message.includes("google") && message.includes("failed")).length
  };
}

export async function listNotifications(userId) {
  return prisma.automationNotification.findMany({
    where: { createdBy: userId },
    include: { schedule: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });
}

export async function markNotificationRead(id, userId) {
  void userId;
  return prisma.automationNotification.update({
    where: { id },
    data: { read: true }
  });
}

function formatAutomationJob(run) {
  return {
    id: run.id,
    type: run.scheduleId ? "scanner_import" : "full_automation_run",
    status: run.completedAt ? "completed" : "running",
    total: run.totalItems || 0,
    completed: run.completedItems || 0,
    skipped: 0,
    failed: run.failedItems || 0,
    currentLeadId: null,
    currentLeadName: null,
    stage: run.currentStage || "Queued",
    progressPercent: run.progressPercent || 0,
    currentUrl: run.currentUrl || null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    scheduleId: run.scheduleId,
    scheduleName: run.schedule?.name || null,
    scanJobId: run.scanJobId || null,
    logs: Array.isArray(run.logs) ? run.logs.slice(-8) : [],
    errors: []
  };
}

export async function getAutomationSettings(userId) {
  const [settings, sendUsage] = await Promise.all([
    getOutreachAutomationSettings(),
    getSendUsage(userId)
  ]);
  return {
    ...settings,
    sendUsage,
    warnings: automationWarnings(settings)
  };
}

export async function updateAutomationSettings(input, userId) {
  const settings = await updateOutreachAutomationSettings(input, userId);
  await notify({
    userId,
    type: "SUCCESS",
    title: "Automation settings updated",
    message: `Automation mode is now ${settings.mode.replaceAll("_", " ").toLowerCase()}.`
  });
  return getAutomationSettings(userId);
}

export async function pauseGlobalAutomation(userId, reason = "") {
  const settings = await updateOutreachAutomationSettings({
    automationPaused: true,
    automationPausedReason: String(reason || "").trim(),
    automationPausedAt: new Date().toISOString()
  }, userId);
  await notify({
    userId,
    type: "INFO",
    title: "Automation paused",
    message: settings.automationPausedReason || "Global automation pause is enabled."
  });
  return getAutomationSettings(userId);
}

export async function resumeGlobalAutomation(userId) {
  await updateOutreachAutomationSettings({
    automationPaused: false,
    automationPausedReason: "",
    automationPausedAt: null
  }, userId);
  await notify({
    userId,
    type: "SUCCESS",
    title: "Automation resumed",
    message: "Global automation pause has been removed."
  });
  return getAutomationSettings(userId);
}

export async function runAutomationNow(userId) {
  const settings = await getOutreachAutomationSettings();
  const schedules = await prisma.automationSchedule.findMany({
    where: { createdBy: userId, enabled: true },
    orderBy: { nextRunAt: "asc" },
    take: settings.batchSize
  });
  const result = { totalSchedules: schedules.length, queued: 0, failed: 0, errors: [] };
  for (const schedule of schedules) {
    try {
      await runSchedule(schedule.id, userId, "manual");
      result.queued += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ scheduleId: schedule.id, scheduleName: schedule.name, reason: error.message });
    }
  }
  await notify({
    userId,
    type: result.failed ? "ERROR" : "SUCCESS",
    title: "Automation run requested",
    message: result.failed
      ? `Queued ${result.queued} schedule(s) with ${result.failed} failure(s).`
      : `Queued ${result.queued} automation schedule(s).`
  });
  return result;
}

export async function getAutomationJobs(userId) {
  const [runs, storedJobs] = await Promise.all([
    prisma.automationRun.findMany({
      where: { schedule: { createdBy: userId } },
      include: { schedule: true },
      orderBy: { createdAt: "desc" },
      take: 25
    }),
    listAutomationJobs()
  ]);
  return [...storedJobs, ...runs.map(formatAutomationJob)]
    .sort((left, right) => new Date(right.startedAt || right.createdAt || 0) - new Date(left.startedAt || left.createdAt || 0))
    .slice(0, 25);
}

export async function getAutomationJob(id, userId) {
  const stored = await getStoredAutomationJob(id);
  if (stored) return stored;
  const run = await prisma.automationRun.findFirst({
    where: { id, schedule: { createdBy: userId } },
    include: { schedule: true }
  });
  if (!run) throw notFound("Automation job not found");
  return formatAutomationJob(run);
}

export async function processDueSchedules() {
  const due = await prisma.automationSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: new Date() }
    },
    take: 5,
    orderBy: { nextRunAt: "asc" }
  });
  for (const schedule of due) {
    runSchedule(schedule.id, schedule.createdBy, "scheduled").catch(() => {});
  }
  return due.length;
}

export function startAutomationScheduler() {
  if (schedulerTimer || process.env.AUTOMATION_SCHEDULER_DISABLED === "true") return;
  schedulerTimer = setInterval(() => {
    processDueSchedules().catch(() => {});
    processBackgroundAutomation().catch(() => {});
  }, Number(process.env.AUTOMATION_POLL_INTERVAL_MS || 60000));
  processDueSchedules().catch(() => {});
  processBackgroundAutomation().catch(() => {});
}

export function stopAutomationScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}
