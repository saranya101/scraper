import { prisma } from "../repositories/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { syncGmailReplies } from "./gmailReplySync.service.js";
import { analyzeLeadServices, runOutreachPipeline } from "./outreachPipelineService.js";
import { approveReport, generateReport } from "./reportService.js";
import { generateDueFollowUpDrafts, sendDueFollowUps } from "./followUpService.js";
import {
  evaluateInitialEmailGuard,
  getOutreachAutomationSettings,
  getSendUsage,
  recipientEmailForLead
} from "./automationGuards.service.js";
import {
  createAutomationJob,
  updateAutomationJob
} from "./automationJobs.service.js";
import { sendEmail } from "./emailService.js";

const AUTOMATION_STAGES = {
  DISCOVERED: "DISCOVERED",
  IMPORTED: "IMPORTED",
  QUALIFIED: "QUALIFIED",
  SERVICES_ANALYZED: "SERVICES_ANALYZED",
  PIPELINE_RAN: "PIPELINE_RAN",
  REPORT_GENERATED: "REPORT_GENERATED",
  REPORT_APPROVED: "REPORT_APPROVED",
  EMAIL_GENERATED: "EMAIL_GENERATED",
  EMAIL_APPROVED: "EMAIL_APPROVED",
  INITIAL_EMAIL_SENT: "INITIAL_EMAIL_SENT",
  REPLY_SYNCED: "REPLY_SYNCED",
  REPLIED: "REPLIED",
  FOLLOW_UP_1_SCHEDULED: "FOLLOW_UP_1_SCHEDULED",
  FOLLOW_UP_1_DUE: "FOLLOW_UP_1_DUE",
  FOLLOW_UP_1_SENT: "FOLLOW_UP_1_SENT",
  FOLLOW_UP_2_SCHEDULED: "FOLLOW_UP_2_SCHEDULED",
  FOLLOW_UP_2_DUE: "FOLLOW_UP_2_DUE",
  FOLLOW_UP_2_SENT: "FOLLOW_UP_2_SENT",
  SEQUENCE_COMPLETED: "SEQUENCE_COMPLETED",
  STOPPED: "STOPPED",
  FAILED: "FAILED",
  NEEDS_ACTION: "NEEDS_ACTION"
};

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function leadAutomationState(lead) {
  return object(object(lead?.scanEvidence).automation);
}

async function writeAutomationState(leadId, updater) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, scanEvidence: true } });
  if (!lead) throw new HttpError(404, "Lead not found");
  const scanEvidence = object(lead.scanEvidence);
  const current = object(scanEvidence.automation);
  const next = typeof updater === "function" ? updater(current, scanEvidence) : updater;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      scanEvidence: {
        ...scanEvidence,
        automation: next
      }
    }
  });
  return next;
}

function latestPipelineState(lead) {
  return object(object(lead?.scanEvidence).outreachPipeline);
}

function latestServiceAnalysis(lead) {
  return object(object(lead?.scanEvidence).serviceAnalysis);
}

function selectedServicesFromLead(lead) {
  const pipeline = latestPipelineState(lead);
  const serviceAnalysis = latestServiceAnalysis(lead);
  return array(pipeline.selectedReportServices).length
    ? array(pipeline.selectedReportServices)
    : array(serviceAnalysis.selectedReportServices);
}

function readLeadQualityScore(lead) {
  return Number(
    leadAutomationState(lead).leadQualityScore
    ?? lead.opportunityScore
    ?? lead.score
    ?? 0
  );
}

function isQualifiedStatus(value = "") {
  return String(value || "").toLowerCase() === "qualified";
}

function blockedIndustry(settings, lead) {
  const industry = String(lead.industryRef?.name || lead.industry || "").trim().toLowerCase();
  if (!industry) return false;
  if (settings.allowedIndustries.length && !settings.allowedIndustries.some((item) => industry.includes(String(item).toLowerCase()))) return true;
  return settings.blockedIndustries.some((item) => industry.includes(String(item).toLowerCase()));
}

function qualificationForLead(lead, settings) {
  const reasons = [];
  const recipient = recipientEmailForLead(lead);
  if (!lead.company) reasons.push("missing_company");
  if (!lead.website) reasons.push("missing_website");
  if (settings.skipIfRecipientMissing && !recipient) reasons.push("missing_recipient");
  if (blockedIndustry(settings, lead)) reasons.push("blocked_industry");
  if (lead.doNotContact) reasons.push("do_not_contact");
  if (lead.bouncedAt || String(lead.emailStatus || "").toUpperCase() === "BOUNCED") reasons.push("bounced");
  if (["NO_WEBSITE", "WEBSITE_OFFLINE", "DOMAIN_PARKED"].includes(String(lead.websiteStatus || "").toUpperCase())) reasons.push("website_unreachable");
  const leadQualityScore = Math.max(
    1,
    Math.min(
      10,
      Math.round((
        Number(lead.opportunityScore || 0)
        + Number(lead.score || 0)
        + (recipient ? 2 : 0)
        + (lead.websiteStatus === "WORKING" ? 1 : 0)
      ) / 2)
    )
  );
  if (leadQualityScore < settings.minimumLeadQualityScore) reasons.push("quality_below_minimum");
  return {
    leadQualityScore,
    leadQualificationStatus: reasons.length ? (reasons.includes("missing_recipient") ? "missing_contact" : "rejected") : "qualified",
    leadQualificationReason: reasons.join(", ") || "qualified",
    recipient
  };
}

async function qualifyLead(lead, settings, userId) {
  const result = qualificationForLead(lead, settings);
  await writeAutomationState(lead.id, (current) => ({
    ...current,
    automationStage: result.leadQualificationStatus === "qualified" ? AUTOMATION_STAGES.QUALIFIED : AUTOMATION_STAGES.NEEDS_ACTION,
    automationEnabled: true,
    automationError: result.leadQualificationStatus === "qualified" ? null : result.leadQualificationReason,
    lastAutomationRunAt: new Date().toISOString(),
    leadQualityScore: result.leadQualityScore,
    leadQualificationStatus: result.leadQualificationStatus,
    leadQualificationReason: result.leadQualificationReason
  }));
  if (result.leadQualificationStatus !== "qualified") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        needsAction: result.leadQualificationStatus === "missing_contact",
        needsActionReason: result.leadQualificationStatus === "missing_contact" ? "missing_recipient_email" : null
      }
    });
    await prisma.leadNote.create({
      data: {
        leadId: lead.id,
        userId,
        note: `Automation qualification skipped: ${result.leadQualificationReason.replaceAll("_", " ")}`
      }
    });
  }
  return result;
}

async function getLeadForAutomation(leadId) {
  return prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      industryRef: true,
      auditReports: { orderBy: { createdAt: "desc" }, take: 3 },
      serviceOpportunities: {
        include: { service: true },
        orderBy: [{ recommended: "desc" }, { score: "desc" }]
      },
      emailSends: {
        orderBy: [{ createdAt: "desc" }],
        take: 20
      }
    }
  });
}

async function ensurePipelineAndReport(lead, userId, settings) {
  let latestLead = lead;
  let serviceAnalysis = latestServiceAnalysis(latestLead);
  if (settings.autoAnalyzeServicesEnabled || settings.autoRunPipelineEnabled || settings.autoGenerateReportsEnabled || settings.autoGenerateEmailsEnabled) {
    serviceAnalysis = await analyzeLeadServices(latestLead.id, { force: false });
    await writeAutomationState(latestLead.id, (current) => ({
      ...current,
      automationStage: AUTOMATION_STAGES.SERVICES_ANALYZED,
      lastAutomationRunAt: new Date().toISOString()
    }));
    latestLead = await getLeadForAutomation(latestLead.id);
  }

  let pipeline = latestPipelineState(latestLead);
  if (settings.autoRunPipelineEnabled || settings.autoGenerateReportsEnabled || settings.autoGenerateEmailsEnabled) {
    await runOutreachPipeline({ leadId: latestLead.id, generateReport: true }, { userId });
    latestLead = await getLeadForAutomation(latestLead.id);
    pipeline = latestPipelineState(latestLead);
    await writeAutomationState(latestLead.id, (current) => ({
      ...current,
      automationStage: AUTOMATION_STAGES.PIPELINE_RAN,
      lastAutomationRunAt: new Date().toISOString()
    }));
  }

  let report = latestLead.auditReports?.[0] || null;
  if (!report && (settings.autoGenerateReportsEnabled || settings.autoApproveReportsEnabled)) {
    const selectedServices = selectedServicesFromLead(latestLead);
    if (selectedServices.length) {
      report = await generateReport(latestLead.id, userId, { selectedServices });
      latestLead = await getLeadForAutomation(latestLead.id);
      report = latestLead.auditReports?.[0] || report;
      await writeAutomationState(latestLead.id, (current) => ({
        ...current,
        automationStage: AUTOMATION_STAGES.REPORT_GENERATED
      }));
    }
  }

  if (report?.qualityGate?.passed && settings.autoApproveReportsEnabled && report.status !== "approved") {
    await approveReport(latestLead.id, userId);
    latestLead = await getLeadForAutomation(latestLead.id);
    report = latestLead.auditReports?.[0] || report;
    await writeAutomationState(latestLead.id, (current) => ({
      ...current,
      automationStage: AUTOMATION_STAGES.REPORT_APPROVED
    }));
  } else if (report && report.qualityGate?.passed) {
    await writeAutomationState(latestLead.id, (current) => ({
      ...current,
      automationStage: AUTOMATION_STAGES.REPORT_GENERATED
    }));
  }

  if (pipeline.email?.body) {
    await writeAutomationState(latestLead.id, (current) => ({
      ...current,
      automationStage: pipeline.qualityGate?.approved ? AUTOMATION_STAGES.EMAIL_APPROVED : AUTOMATION_STAGES.EMAIL_GENERATED
    }));
  }

  if ((report && !report.qualityGate?.passed) || (pipeline.email && !pipeline.qualityGate?.approved)) {
    await prisma.lead.update({
      where: { id: latestLead.id },
      data: {
        needsAction: true,
        needsActionReason: report && !report.qualityGate?.passed ? "report_quality_failed" : "email_quality_failed"
      }
    });
    await writeAutomationState(latestLead.id, (current) => ({
      ...current,
      automationStage: AUTOMATION_STAGES.NEEDS_ACTION
    }));
  }

  return { lead: latestLead, serviceAnalysis, pipeline, report };
}

function initialEmailPayload(lead) {
  const pipeline = latestPipelineState(lead);
  const editedDraft = object(pipeline.editedDraft);
  const subject = editedDraft.subject || pipeline.email?.subject || "";
  const body = editedDraft.fullEmail || editedDraft.body || pipeline.email?.body || "";
  const emailSelectedServices = array(pipeline.emailSelectedServices).length
    ? array(pipeline.emailSelectedServices)
    : selectedServicesFromLead(lead);
  return { subject, body, emailSelectedServices };
}

async function sendInitialEmailIfEligible(lead, userId, settings) {
  const guard = await evaluateInitialEmailGuard({ userId, lead, settings });
  if (!guard.eligible) {
    return { sent: false, skipped: true, reason: guard.reasons.join(", ") || "Lead is not eligible" };
  }
  if (!settings.autoSendInitialEmailsEnabled || settings.requireManualApprovalBeforeInitialSend) {
    return { sent: false, skipped: true, reason: "Initial auto-send is disabled or manual approval is required" };
  }
  const payload = initialEmailPayload(lead);
  if (!payload.subject || !payload.body) return { sent: false, skipped: true, reason: "Email draft is missing" };
  const send = await sendEmail(userId, {
    leadId: lead.id,
    toEmail: recipientEmailForLead(lead),
    subject: payload.subject,
    body: payload.body,
    includeReport: true,
    emailSelectedServices: payload.emailSelectedServices,
    mode: "AUTO_SEND"
  });
  await writeAutomationState(lead.id, (current) => ({
    ...current,
    automationStage: AUTOMATION_STAGES.INITIAL_EMAIL_SENT,
    automationError: null,
    lastAutomationRunAt: new Date().toISOString()
  }));
  return { sent: true, send };
}

async function processSingleLead(lead, userId, settings) {
  const qualification = await qualifyLead(lead, settings, userId);
  if (!isQualifiedStatus(qualification.leadQualificationStatus)) {
    return { leadId: lead.id, leadName: lead.company, status: "skipped", stage: "qualification", reason: qualification.leadQualificationReason };
  }
  const workflow = await ensurePipelineAndReport(lead, userId, settings);
  const refreshedLead = workflow.lead;
  const sendDecision = await sendInitialEmailIfEligible(refreshedLead, userId, settings);
  if (sendDecision.sent) {
    return { leadId: lead.id, leadName: lead.company, status: "sent", stage: "send", reason: null };
  }
  return { leadId: lead.id, leadName: lead.company, status: sendDecision.skipped ? "processed" : "processed", stage: "pipeline", reason: sendDecision.reason || null };
}

function progressPercent(index, total) {
  if (!total) return 100;
  return Math.max(0, Math.min(100, Math.round((index / total) * 100)));
}

export async function processAutomationLeads(userId, input = {}) {
  const settings = await getOutreachAutomationSettings();
  const leadIds = array(input.leadIds);
  const where = {
    status: { not: "ARCHIVED" },
    ...(leadIds.length ? { id: { in: leadIds } } : {})
  };
  const leads = await prisma.lead.findMany({
    where,
    include: {
      industryRef: true,
      auditReports: { orderBy: { createdAt: "desc" }, take: 3 },
      serviceOpportunities: { include: { service: true }, orderBy: [{ recommended: "desc" }, { score: "desc" }] },
      emailSends: { orderBy: { createdAt: "desc" }, take: 10 }
    },
    orderBy: [{ updatedAt: "desc" }],
    take: leadIds.length || settings.batchSize
  });

  const job = await createAutomationJob({
    type: "full_automation_run",
    status: "running",
    total: leads.length,
    stage: "Processing leads"
  }, userId);

  const summary = {
    total: leads.length,
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    skippedReasons: [],
    failedReasons: []
  };

  for (let index = 0; index < leads.length; index += 1) {
    const lead = leads[index];
    await updateAutomationJob(job.id, {
      currentLeadId: lead.id,
      currentLeadName: lead.company,
      completed: index,
      progressPercent: progressPercent(index, leads.length),
      stage: "Processing leads"
    }, userId);
    try {
      const result = await processSingleLead(lead, userId, settings);
      if (result.status === "sent") summary.sent += 1;
      else if (result.reason) {
        summary.skipped += 1;
        summary.skippedReasons.push({ leadId: lead.id, leadName: lead.company, reason: result.reason });
      } else {
        summary.processed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.failedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message || "Automation failed" });
      await writeAutomationState(lead.id, (current) => ({
        ...current,
        automationStage: AUTOMATION_STAGES.FAILED,
        automationError: error.message || "Automation failed",
        lastAutomationRunAt: new Date().toISOString()
      }));
    }
  }

  await updateAutomationJob(job.id, {
    status: summary.failed ? "completed" : "completed",
    completed: leads.length,
    skipped: summary.skipped,
    failed: summary.failed,
    progressPercent: 100,
    stage: "Completed",
    summary,
    errors: summary.failedReasons
  }, userId);

  return { ...summary, jobId: job.id };
}

export async function sendApprovedAutomationEmails(userId, input = {}) {
  const settings = await getOutreachAutomationSettings();
  const leadIds = array(input.leadIds);
  const leads = await prisma.lead.findMany({
    where: {
      status: { not: "ARCHIVED" },
      ...(leadIds.length ? { id: { in: leadIds } } : {}),
      OR: [
        { emailStatus: "READY_TO_SEND" },
        { pipelineStage: "DRAFTED" }
      ]
    },
    include: {
      industryRef: true,
      auditReports: { orderBy: { createdAt: "desc" }, take: 3 },
      emailSends: { orderBy: { createdAt: "desc" }, take: 10 }
    },
    orderBy: [{ updatedAt: "desc" }],
    take: leadIds.length || settings.batchSize
  });
  const summary = { total: leads.length, sent: 0, skipped: 0, failed: 0, skippedReasons: [], failedReasons: [] };
  for (const lead of leads) {
    try {
      const decision = await sendInitialEmailIfEligible(lead, userId, settings);
      if (decision.sent) summary.sent += 1;
      else {
        summary.skipped += 1;
        summary.skippedReasons.push({ leadId: lead.id, leadName: lead.company, reason: decision.reason || "Not eligible" });
      }
    } catch (error) {
      summary.failed += 1;
      summary.failedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message || "Send failed" });
    }
  }
  return summary;
}

export async function syncRepliesAutomation(userId) {
  const result = await syncGmailReplies({ initiatedByUserId: userId, source: "automation" });
  return result;
}

export async function processAutomationFollowUps(userId) {
  const settings = await getOutreachAutomationSettings();
  if (settings.autoSendFollowUpsEnabled && settings.requireManualApprovalBeforeFollowUpSend === false) {
    return sendDueFollowUps(userId);
  }
  return generateDueFollowUpDrafts(userId);
}

export async function getAutomationInbox(userId) {
  const [needsAction, dueFollowUps, sendUsage, settings] = await Promise.all([
    prisma.lead.findMany({
      where: { status: { not: "ARCHIVED" }, needsAction: true },
      orderBy: [{ repliedAt: "desc" }, { updatedAt: "desc" }],
      take: 20,
      select: {
        id: true,
        company: true,
        lastReplySnippet: true,
        lastReplyFrom: true,
        needsActionReason: true,
        replyClassification: true,
        followUpStatus: true,
        nextFollowUpAt: true,
        doNotContact: true,
        bouncedAt: true,
        updatedAt: true
      }
    }),
    prisma.lead.findMany({
      where: {
        status: { not: "ARCHIVED" },
        nextFollowUpAt: { not: null },
        doNotContact: false,
        bouncedAt: null,
        repliedAt: null
      },
      orderBy: [{ nextFollowUpAt: "asc" }],
      take: 20,
      select: {
        id: true,
        company: true,
        followUpStatus: true,
        nextFollowUpAt: true,
        updatedAt: true
      }
    }),
    getSendUsage(userId),
    getOutreachAutomationSettings()
  ]);

  const now = new Date();
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return {
    needsAction,
    followUpReminders: {
      dueToday: dueFollowUps.filter((lead) => lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) <= today).length,
      dueTomorrow: dueFollowUps.filter((lead) => lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) > today && new Date(lead.nextFollowUpAt) <= tomorrow).length,
      overdue: dueFollowUps.filter((lead) => lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < now).length,
      items: dueFollowUps
    },
    sendUsage,
    settings
  };
}

export async function getAutomationDashboardData(userId) {
  const [sendUsage, settings, reportsGenerated, reportsApproved, emailsGenerated, emailsSent, repliesDetected, interestedReplies, followUpsSent, failedLeads] = await Promise.all([
    getSendUsage(userId),
    getOutreachAutomationSettings(),
    prisma.auditReport.count({ where: { userId } }),
    prisma.auditReport.count({ where: { userId, status: "approved" } }),
    prisma.lead.count({ where: { OR: [{ emailStatus: "READY_TO_SEND" }, { pipelineStage: "DRAFTED" }] } }),
    prisma.emailSend.count({ where: { userId, status: "SENT", eventType: "OUTBOUND" } }),
    prisma.emailSend.count({ where: { userId, eventType: "REPLY" } }),
    prisma.lead.count({ where: { replyClassification: "INTERESTED" } }),
    prisma.emailSend.count({ where: { userId, status: "SENT", eventType: { in: ["FOLLOW_UP_1", "FOLLOW_UP_2"] } } }),
    prisma.lead.count({
      where: {
        OR: [
          { needsAction: true },
          { bouncedAt: { not: null } },
          { emailStatus: "FAILED" }
        ]
      }
    })
  ]);
  return {
    automationMode: settings.mode,
    automationPaused: settings.automationPaused,
    sendUsage,
    reportsGenerated,
    reportsApproved,
    emailsGenerated,
    emailsSent,
    repliesDetected,
    interestedReplies,
    followUpsSent,
    failedLeads
  };
}

export async function scannerImportAutomation(userId) {
  const recentJobs = await prisma.scanJob.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true }
  });
  const results = await prisma.scanResult.findMany({
    where: { scanJobId: { in: recentJobs.map((job) => job.id) } },
    select: { id: true, imported: true, duplicate: true }
  });
  return {
    totalResults: results.length,
    imported: results.filter((item) => item.imported).length,
    duplicates: results.filter((item) => item.duplicate).length,
    skipped: results.filter((item) => !item.imported && !item.duplicate).length
  };
}
