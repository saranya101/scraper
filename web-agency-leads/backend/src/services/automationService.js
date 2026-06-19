import { prisma } from "../repositories/prisma.js";
import { notFound } from "../utils/httpError.js";
import * as scannerService from "./scannerService.js";

const runningSchedules = new Set();
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

async function notify({ scheduleId, userId, type = "INFO", title, message }) {
  return prisma.automationNotification.create({
    data: { scheduleId, createdBy: userId, type, title, message }
  });
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
  return prisma.automationSchedule.findMany({
    where: { createdBy: userId },
    include: { template: true, _count: { select: { notifications: true } } },
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }, { createdAt: "desc" }]
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

export async function listNotifications(userId) {
  return prisma.automationNotification.findMany({
    where: { createdBy: userId },
    include: { schedule: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });
}

export async function markNotificationRead(id, userId) {
  return prisma.automationNotification.update({
    where: { id },
    data: { read: true }
  });
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
  }, Number(process.env.AUTOMATION_POLL_INTERVAL_MS || 60000));
  processDueSchedules().catch(() => {});
}

export function stopAutomationScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}
