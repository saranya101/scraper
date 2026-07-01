import { prisma } from "../repositories/prisma.js";

export const automationModes = {
  MANUAL_REVIEW: "MANUAL_REVIEW",
  SEMI_AUTOMATIC: "SEMI_AUTOMATIC",
  FULL_AUTOMATION: "FULL_AUTOMATION"
};

export const outreachAutomationDefaults = {
  mode: automationModes.MANUAL_REVIEW,
  scannerAutoImportEnabled: false,
  autoAnalyzeLeadsEnabled: true,
  autoAnalyzeServicesEnabled: true,
  autoRunPipelineEnabled: false,
  autoGenerateReportsEnabled: false,
  autoApproveReportsEnabled: false,
  autoGenerateEmailsEnabled: false,
  autoSendInitialEmailsEnabled: false,
  autoSyncRepliesEnabled: false,
  autoGenerateFollowUpsEnabled: true,
  autoSendFollowUpsEnabled: false,
  requireManualApprovalBeforeInitialSend: true,
  requireManualApprovalBeforeFollowUpSend: true,
  dailySendLimit: 30,
  hourlySendLimit: 10,
  dailyFollowUpLimit: 30,
  hourlyFollowUpLimit: 10,
  batchSize: 10,
  minimumLeadQualityScore: 8,
  minimumReportQualityScore: 8,
  minimumEmailQualityScore: 8,
  allowedIndustries: [],
  blockedIndustries: [],
  sendWindowStart: "09:00",
  sendWindowEnd: "18:00",
  sendTimezone: "Asia/Singapore",
  skipIfReportMissing: true,
  skipIfRecipientMissing: true,
  skipIfDuplicateDomain: true,
  skipIfDuplicateEmail: true,
  skipIfDoNotContact: true,
  skipIfBounced: true,
  automationPaused: false,
  automationPausedReason: "",
  automationPausedAt: null
};

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/,|\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback) {
  if (value == null) return fallback;
  return Boolean(value);
}

export function normalizeAutomationSettings(input = {}) {
  const next = { ...outreachAutomationDefaults, ...(input && typeof input === "object" ? input : {}) };
  return {
    ...next,
    mode: Object.values(automationModes).includes(String(next.mode).toUpperCase())
      ? String(next.mode).toUpperCase()
      : outreachAutomationDefaults.mode,
    scannerAutoImportEnabled: toBoolean(next.scannerAutoImportEnabled, outreachAutomationDefaults.scannerAutoImportEnabled),
    autoAnalyzeLeadsEnabled: toBoolean(next.autoAnalyzeLeadsEnabled, outreachAutomationDefaults.autoAnalyzeLeadsEnabled),
    autoAnalyzeServicesEnabled: toBoolean(next.autoAnalyzeServicesEnabled, outreachAutomationDefaults.autoAnalyzeServicesEnabled),
    autoRunPipelineEnabled: toBoolean(next.autoRunPipelineEnabled, outreachAutomationDefaults.autoRunPipelineEnabled),
    autoGenerateReportsEnabled: toBoolean(next.autoGenerateReportsEnabled, outreachAutomationDefaults.autoGenerateReportsEnabled),
    autoApproveReportsEnabled: toBoolean(next.autoApproveReportsEnabled, outreachAutomationDefaults.autoApproveReportsEnabled),
    autoGenerateEmailsEnabled: toBoolean(next.autoGenerateEmailsEnabled, outreachAutomationDefaults.autoGenerateEmailsEnabled),
    autoSendInitialEmailsEnabled: toBoolean(next.autoSendInitialEmailsEnabled, outreachAutomationDefaults.autoSendInitialEmailsEnabled),
    autoSyncRepliesEnabled: toBoolean(next.autoSyncRepliesEnabled, outreachAutomationDefaults.autoSyncRepliesEnabled),
    autoGenerateFollowUpsEnabled: toBoolean(next.autoGenerateFollowUpsEnabled, outreachAutomationDefaults.autoGenerateFollowUpsEnabled),
    autoSendFollowUpsEnabled: toBoolean(next.autoSendFollowUpsEnabled, outreachAutomationDefaults.autoSendFollowUpsEnabled),
    requireManualApprovalBeforeInitialSend: toBoolean(next.requireManualApprovalBeforeInitialSend, outreachAutomationDefaults.requireManualApprovalBeforeInitialSend),
    requireManualApprovalBeforeFollowUpSend: toBoolean(next.requireManualApprovalBeforeFollowUpSend, outreachAutomationDefaults.requireManualApprovalBeforeFollowUpSend),
    dailySendLimit: Math.max(1, toNumber(next.dailySendLimit, outreachAutomationDefaults.dailySendLimit)),
    hourlySendLimit: Math.max(1, toNumber(next.hourlySendLimit, outreachAutomationDefaults.hourlySendLimit)),
    dailyFollowUpLimit: Math.max(1, toNumber(next.dailyFollowUpLimit, outreachAutomationDefaults.dailyFollowUpLimit)),
    hourlyFollowUpLimit: Math.max(1, toNumber(next.hourlyFollowUpLimit, outreachAutomationDefaults.hourlyFollowUpLimit)),
    batchSize: Math.max(1, toNumber(next.batchSize, outreachAutomationDefaults.batchSize)),
    minimumLeadQualityScore: Math.min(10, Math.max(0, toNumber(next.minimumLeadQualityScore, outreachAutomationDefaults.minimumLeadQualityScore))),
    minimumReportQualityScore: Math.min(10, Math.max(0, toNumber(next.minimumReportQualityScore, outreachAutomationDefaults.minimumReportQualityScore))),
    minimumEmailQualityScore: Math.min(10, Math.max(0, toNumber(next.minimumEmailQualityScore, outreachAutomationDefaults.minimumEmailQualityScore))),
    allowedIndustries: parseList(next.allowedIndustries),
    blockedIndustries: parseList(next.blockedIndustries),
    sendWindowStart: /^\d{2}:\d{2}$/.test(String(next.sendWindowStart || "")) ? String(next.sendWindowStart) : outreachAutomationDefaults.sendWindowStart,
    sendWindowEnd: /^\d{2}:\d{2}$/.test(String(next.sendWindowEnd || "")) ? String(next.sendWindowEnd) : outreachAutomationDefaults.sendWindowEnd,
    sendTimezone: String(next.sendTimezone || outreachAutomationDefaults.sendTimezone).trim() || outreachAutomationDefaults.sendTimezone,
    skipIfReportMissing: toBoolean(next.skipIfReportMissing, outreachAutomationDefaults.skipIfReportMissing),
    skipIfRecipientMissing: toBoolean(next.skipIfRecipientMissing, outreachAutomationDefaults.skipIfRecipientMissing),
    skipIfDuplicateDomain: toBoolean(next.skipIfDuplicateDomain, outreachAutomationDefaults.skipIfDuplicateDomain),
    skipIfDuplicateEmail: toBoolean(next.skipIfDuplicateEmail, outreachAutomationDefaults.skipIfDuplicateEmail),
    skipIfDoNotContact: toBoolean(next.skipIfDoNotContact, outreachAutomationDefaults.skipIfDoNotContact),
    skipIfBounced: toBoolean(next.skipIfBounced, outreachAutomationDefaults.skipIfBounced),
    automationPaused: toBoolean(next.automationPaused, outreachAutomationDefaults.automationPaused),
    automationPausedReason: String(next.automationPausedReason || "").trim(),
    automationPausedAt: next.automationPausedAt ? new Date(next.automationPausedAt).toISOString() : null
  };
}

export async function getOutreachAutomationSettings() {
  const saved = await prisma.appSetting.findUnique({ where: { key: "outreachAutomation" } });
  return normalizeAutomationSettings(saved?.value || {});
}

export async function saveOutreachAutomationSettings(value, userId) {
  const normalized = normalizeAutomationSettings(value);
  await prisma.appSetting.upsert({
    where: { key: "outreachAutomation" },
    create: { key: "outreachAutomation", value: normalized, updatedBy: userId },
    update: { value: normalized, updatedBy: userId }
  });
  return normalized;
}

export async function updateOutreachAutomationSettings(updates, userId) {
  const current = await getOutreachAutomationSettings();
  return saveOutreachAutomationSettings({ ...current, ...(updates || {}) }, userId);
}

function timePartsInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((item) => item.type === "hour")?.value || 0);
  const minute = Number(parts.find((item) => item.type === "minute")?.value || 0);
  return { hour, minute, minutes: hour * 60 + minute };
}

function parseClock(value, fallback) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return parseClock(fallback, "00:00");
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isWithinSendWindow(settings, date = new Date()) {
  const timeZone = settings.sendTimezone || outreachAutomationDefaults.sendTimezone;
  const start = parseClock(settings.sendWindowStart, outreachAutomationDefaults.sendWindowStart);
  const end = parseClock(settings.sendWindowEnd, outreachAutomationDefaults.sendWindowEnd);
  const current = timePartsInZone(date, timeZone).minutes;
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

export function recipientEmailForLead(lead) {
  return String(lead?.ownerEmail || lead?.generalEmail || "").trim().toLowerCase();
}

function websiteDomain(url = "") {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hasApprovedReport(lead) {
  const reports = Array.isArray(lead?.auditReports) ? lead.auditReports : [];
  return reports.some((report) => ["approved", "attached", "sent"].includes(String(report.status || "").toLowerCase()) && (report.pdfUrl || report.pdfPath));
}

function readLeadQuality(lead) {
  return Number(
    lead?.leadQualityScore
    ?? lead?.opportunityScore
    ?? lead?.score
    ?? 0
  );
}

export async function getSendUsage(userId) {
  const settings = await getOutreachAutomationSettings();
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const hour = new Date(now);
  hour.setMinutes(0, 0, 0);

  const [initialSentToday, initialSentThisHour, followUpsSentToday, followUpsSentThisHour] = await Promise.all([
    prisma.emailSend.count({
      where: { userId, status: "SENT", eventType: "OUTBOUND", sentAt: { gte: today } }
    }),
    prisma.emailSend.count({
      where: { userId, status: "SENT", eventType: "OUTBOUND", sentAt: { gte: hour } }
    }),
    prisma.emailSend.count({
      where: { userId, status: "SENT", eventType: { in: ["FOLLOW_UP_1", "FOLLOW_UP_2"] }, sentAt: { gte: today } }
    }),
    prisma.emailSend.count({
      where: { userId, status: "SENT", eventType: { in: ["FOLLOW_UP_1", "FOLLOW_UP_2"] }, sentAt: { gte: hour } }
    })
  ]);

  return {
    initial: {
      today: initialSentToday,
      thisHour: initialSentThisHour,
      dailyLimit: settings.dailySendLimit,
      hourlyLimit: settings.hourlySendLimit,
      remainingToday: Math.max(0, settings.dailySendLimit - initialSentToday),
      remainingThisHour: Math.max(0, settings.hourlySendLimit - initialSentThisHour)
    },
    followUp: {
      today: followUpsSentToday,
      thisHour: followUpsSentThisHour,
      dailyLimit: settings.dailyFollowUpLimit,
      hourlyLimit: settings.hourlyFollowUpLimit,
      remainingToday: Math.max(0, settings.dailyFollowUpLimit - followUpsSentToday),
      remainingThisHour: Math.max(0, settings.hourlyFollowUpLimit - followUpsSentThisHour)
    }
  };
}

async function recentlyContactedDomain(domain, leadId) {
  if (!domain) return false;
  const existing = await prisma.lead.findFirst({
    where: {
      id: { not: leadId },
      website: { contains: domain, mode: "insensitive" },
      OR: [
        { emailStatus: { in: ["SENT", "REPLIED", "BOUNCED"] } },
        { lastEmailSentAt: { not: null } },
        { repliedAt: { not: null } }
      ]
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function recentlyContactedEmail(email, leadId) {
  if (!email) return false;
  const existing = await prisma.emailSend.findFirst({
    where: {
      leadId: { not: leadId },
      status: "SENT",
      toEmail: email
    },
    select: { id: true }
  });
  return Boolean(existing);
}

export async function evaluateInitialEmailGuard({ userId, lead, settings, now = new Date() }) {
  const automation = settings || await getOutreachAutomationSettings();
  const usage = await getSendUsage(userId);
  const reasons = [];
  const recipient = recipientEmailForLead(lead);

  if (automation.automationPaused) reasons.push("Automation is paused");
  if (!lead) reasons.push("Lead not found");
  if (automation.skipIfRecipientMissing && !recipient) reasons.push("Missing recipient email");
  if (automation.skipIfDoNotContact && lead?.doNotContact) reasons.push("Lead is marked do not contact");
  if (automation.skipIfBounced && (lead?.bouncedAt || String(lead?.emailStatus || "").toUpperCase() === "BOUNCED" || lead?.pipelineStage === "BOUNCED")) {
    reasons.push("Lead previously bounced");
  }
  if (["REPLIED", "SENT", "BOUNCED"].includes(String(lead?.emailStatus || "").toUpperCase())) reasons.push("Lead already has an email outcome");
  if (["REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(String(lead?.pipelineStage || "").toUpperCase())) reasons.push("Lead is already past the initial outreach stage");
  if (!isWithinSendWindow(automation, now)) reasons.push(`Outside send window (${automation.sendWindowStart}-${automation.sendWindowEnd} ${automation.sendTimezone})`);
  if (usage.initial.remainingToday <= 0) reasons.push("Daily initial email limit reached");
  if (usage.initial.remainingThisHour <= 0) reasons.push("Hourly initial email limit reached");
  if (readLeadQuality(lead) < automation.minimumLeadQualityScore) reasons.push(`Lead quality below minimum (${automation.minimumLeadQualityScore})`);
  if (automation.skipIfReportMissing && !hasApprovedReport(lead)) reasons.push("Missing approved report");

  const industry = String(lead?.industryRef?.name || lead?.industry || "").trim().toLowerCase();
  if (automation.allowedIndustries.length && industry && !automation.allowedIndustries.some((item) => industry.includes(String(item).toLowerCase()))) {
    reasons.push("Lead industry is not in the allowed list");
  }
  if (automation.blockedIndustries.some((item) => industry.includes(String(item).toLowerCase()))) {
    reasons.push("Lead industry is blocked");
  }

  if (automation.skipIfDuplicateEmail && await recentlyContactedEmail(recipient, lead?.id)) reasons.push("Recipient email was already contacted");
  if (automation.skipIfDuplicateDomain && await recentlyContactedDomain(websiteDomain(lead?.website), lead?.id)) reasons.push("Domain was already contacted");

  return {
    eligible: reasons.length === 0,
    reasons,
    recipient,
    usage,
    withinSendWindow: isWithinSendWindow(automation, now)
  };
}
