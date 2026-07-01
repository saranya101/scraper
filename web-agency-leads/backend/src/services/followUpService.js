import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { sendEmail } from "./emailService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_UP_1_DELAY_DAYS = 3;
const FOLLOW_UP_2_DELAY_DAYS = 4;
const FOLLOW_UP_WORD_LIMIT = 120;
const aggressivePhrases = [/increase revenue/ig, /boost conversions/ig, /urgent/ig, /last chance/ig, /act now/ig];

function recipientEmail(lead) {
  return String(lead.ownerEmail || lead.generalEmail || "").trim();
}

function nowPlusDays(days) {
  return new Date(Date.now() + days * DAY_MS);
}

function followUpType(step) {
  return step === 2 ? "FOLLOW_UP_2" : "FOLLOW_UP_1";
}

function isStoppedLead(lead) {
  return ["REPLIED", "BOUNCED", "REJECTED"].includes(String(lead.emailStatus || "").toUpperCase())
    || Boolean(lead.repliedAt)
    || Boolean(lead.doNotContact)
    || Boolean(lead.bouncedAt)
    || ["REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(lead.pipelineStage);
}

function followUpStepForLead(lead) {
  return Number(lead.followUpStep || 0) >= 1 ? 2 : 1;
}

function isLeadApprovedForFollowUp(lead) {
  const workflow = lead.scanEvidence && typeof lead.scanEvidence === "object" ? lead.scanEvidence.outreachPipeline : null;
  return workflow?.status === "APPROVED" || lead.emailStatus === "SENT" || lead.pipelineStage === "SENT" || Boolean(lead.lastEmailSentAt);
}

function followUpEligibility(lead, { requireDue = true } = {}) {
  if (!lead) return { eligible: false, reason: "Lead not found" };
  if (!recipientEmail(lead)) return { eligible: false, reason: "Missing recipient email" };
  if (!isLeadApprovedForFollowUp(lead)) return { eligible: false, reason: "Lead is not in a sent/approved state" };
  if (isStoppedLead(lead)) return { eligible: false, reason: "Lead already replied or left the follow-up flow" };
  if (["COMPLETED", "STOPPED"].includes(lead.followUpStatus)) return { eligible: false, reason: "Follow-up sequence already stopped" };
  const step = followUpStepForLead(lead);
  if (step > 2) return { eligible: false, reason: "Follow-up sequence already completed" };
  if (requireDue && (!lead.nextFollowUpAt || new Date(lead.nextFollowUpAt) > new Date())) {
    return { eligible: false, reason: "Follow-up is not due yet" };
  }
  return { eligible: true, step };
}

function extractSelectedServices(lead, report) {
  const fromReport = Array.isArray(report?.selectedServices) ? report.selectedServices : [];
  if (fromReport.length) return fromReport.map((item) => ({
    id: item.id,
    label: item.label || item.id,
    description: item.description || ""
  }));
  const serviceAnalysis = lead.scanEvidence && typeof lead.scanEvidence === "object" ? lead.scanEvidence.serviceAnalysis : null;
  const analyzed = Array.isArray(serviceAnalysis?.analyzedServices) ? serviceAnalysis.analyzedServices : [];
  const selectedIds = Array.isArray(serviceAnalysis?.selectedReportServices) ? serviceAnalysis.selectedReportServices : [];
  const selected = analyzed.filter((item) => selectedIds.includes(item.serviceId));
  if (selected.length) {
    return selected.map((item) => ({
      id: item.serviceId,
      label: item.serviceLabel || item.serviceId,
      description: item.reason || ""
    }));
  }
  return (lead.serviceOpportunities || []).slice(0, 3).map((item) => ({
    id: item.service?.slug || item.serviceId,
    label: item.service?.name || item.serviceId,
    description: item.reason || ""
  }));
}

function splitDraft(fullMessage = "") {
  const parts = String(fullMessage || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    opener: parts[0] || "",
    pitch: parts[1] || "",
    cta: parts.slice(2).join("\n\n") || ""
  };
}

function normalizeWordyText(value = "") {
  return String(value || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function validateFollowUpDraft({ body, subject, initialBody }) {
  if (!normalizeWordyText(subject)) throw new HttpError(422, "Follow-up subject is required");
  if (!normalizeWordyText(body)) throw new HttpError(422, "Follow-up body is empty");
  const words = normalizeWordyText(body).split(/\s+/).filter(Boolean);
  if (words.length > FOLLOW_UP_WORD_LIMIT) throw new HttpError(422, `Follow-up must stay under ${FOLLOW_UP_WORD_LIMIT} words`);
  if (normalizeWordyText(body).toLowerCase() === normalizeWordyText(initialBody).toLowerCase()) {
    throw new HttpError(422, "Follow-up cannot be identical to the initial email");
  }
  const badPhrase = aggressivePhrases.find((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(body);
  });
  if (badPhrase) throw new HttpError(422, "Follow-up contains language that is too aggressive");
}

function fallbackFollowUp({ lead, step, initialSend, selectedServices, report }) {
  const firstName = String(lead.ownerName || "").trim().split(/\s+/)[0] || "there";
  const focus = selectedServices.map((item) => item.label).filter(Boolean).slice(0, 2).join(" and ");
  const reportMention = report?.pdfUrl || report?.pdfPath || report?.status === "approved" || report?.status === "attached" || report?.status === "sent"
    ? ` I had attached a short website opportunity report${focus ? ` focused on ${focus}` : ""}.`
    : "";
  const company = lead.company || "your team";
  const initialSubject = normalizeWordyText(initialSend?.subject || `Quick idea for ${company}`);
  const subject = /^re:/i.test(initialSubject) ? initialSubject : `Re: ${initialSubject}`;
  if (step === 1) {
    return {
      subject,
      fullMessage: `Hi ${firstName},

Just wanted to follow up on the short website opportunity report I sent over.${reportMention}

The main angle I noticed was around ${focus || "making the enquiry path easier for interested visitors"}. Would it be useful if I showed what a cleaner version of that flow could look like?

Thanks,
Arjun`
    };
  }
  return {
    subject,
    fullMessage: `Hi ${firstName},

Just checking once more in case my earlier note got buried.${reportMention}

If improving ${focus || "the website enquiry flow"} is not a priority right now, no worries at all. But if it is on your radar, I am happy to share a few quick suggestions.

Thanks,
Arjun`
  };
}

async function generateFollowUpCopy(context) {
  const fallback = fallbackFollowUp(context);
  if (!process.env.OPENAI_API_KEY) return fallback;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const serviceLabels = context.selectedServices.map((item) => item.label).filter(Boolean);
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: "You write concise, natural B2B follow-up emails. Return only valid JSON."
      },
      {
        role: "user",
        content: `Write follow-up ${context.step} for a web agency outreach thread.

Rules:
- Keep it under ${FOLLOW_UP_WORD_LIMIT} words.
- Be natural, calm, and not pushy.
- Reference the earlier email without repeating it.
- ${context.report ? "Mention the short report once if natural." : "Do not mention a report or attachment."}
- Use only these selected services/angles if you mention service focus: ${serviceLabels.join(", ") || "general website enquiry flow"}.
- Do not mention any services outside that list.
- Avoid hype, urgency, or salesy language.
- Do not use "just bumping this".

Lead:
Company: ${context.lead.company}
Industry: ${context.lead.industryRef?.name || context.lead.industry || "Unknown"}
Original subject: ${context.initialSend.subject}
Original email:
${context.initialSend.body}

Latest report summary:
${context.report?.summary || "No report summary available"}

Return JSON:
{
  "subject": "",
  "fullMessage": ""
}`
      }
    ]
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  return {
    subject: parsed.subject || fallback.subject,
    fullMessage: parsed.fullMessage || fallback.fullMessage
  };
}

async function leadContext(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      industryRef: true,
      serviceOpportunities: {
        include: { service: true },
        orderBy: [{ recommended: "desc" }, { score: "desc" }]
      },
      auditReports: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      emailSends: {
        where: { status: "SENT", eventType: { in: ["OUTBOUND", "FOLLOW_UP_1", "FOLLOW_UP_2"] } },
        orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }]
      }
    }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

async function followUpMode() {
  const saved = await prisma.appSetting.findUnique({ where: { key: "emailSending" } });
  return String(saved?.value?.followUpMode || "MANUAL_APPROVAL").toUpperCase();
}

export async function scheduleInitialFollowUp(tx, lead, sentAt = new Date()) {
  return tx.lead.update({
    where: { id: lead.id },
    data: {
      followUpStatus: "SCHEDULED",
      followUpStep: 0,
      nextFollowUpAt: new Date(sentAt.getTime() + FOLLOW_UP_1_DELAY_DAYS * DAY_MS),
      lastFollowUpSentAt: null,
      followUpStoppedReason: null
    }
  });
}

export async function stopFollowUps(tx, leadId, reason) {
  return tx.lead.update({
    where: { id: leadId },
    data: {
      followUpStatus: "STOPPED",
      nextFollowUpAt: null,
      followUpStoppedReason: reason || "stopped"
    }
  });
}

export async function markFollowUpDueLeads() {
  const now = new Date();
  const leads = await prisma.lead.findMany({
    where: {
      nextFollowUpAt: { lte: now },
      followUpStatus: { in: ["SCHEDULED", "FOLLOW_UP_1_SENT"] },
      repliedAt: null,
      emailStatus: { not: "REPLIED" }
    },
    select: { id: true, followUpStep: true }
  });
  if (!leads.length) return { updated: 0 };
  await prisma.$transaction(leads.map((lead) => prisma.lead.update({
    where: { id: lead.id },
    data: {
      followUpStatus: Number(lead.followUpStep || 0) >= 1 ? "FOLLOW_UP_2_DUE" : "FOLLOW_UP_1_DUE"
    }
  })));
  return { updated: leads.length };
}

export async function listDueFollowUps() {
  await markFollowUpDueLeads();
  const now = new Date();
  return prisma.lead.findMany({
    where: {
      nextFollowUpAt: { lte: now },
      followUpStatus: { in: ["FOLLOW_UP_1_DUE", "FOLLOW_UP_2_DUE", "SCHEDULED", "FOLLOW_UP_1_SENT"] },
      repliedAt: null,
      emailStatus: { notIn: ["REPLIED", "BOUNCED"] },
      doNotContact: false,
      bouncedAt: null
    },
    orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }],
    include: {
      industryRef: true,
      auditReports: { orderBy: { createdAt: "desc" }, take: 1 },
      serviceOpportunities: {
        include: { service: true },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 4
      }
    }
  });
}

async function upsertDraft({ leadId, userId, type, subject, fullMessage }) {
  const parts = splitDraft(fullMessage);
  const existing = await prisma.outreachDraft.findFirst({
    where: {
      leadId,
      userId,
      type,
      status: { in: ["DRAFT", "SAVED", "COPIED"] }
    },
    orderBy: { updatedAt: "desc" }
  });
  if (existing) {
    return prisma.outreachDraft.update({
      where: { id: existing.id },
      data: {
        subject,
        opener: parts.opener,
        pitch: parts.pitch,
        cta: parts.cta,
        fullMessage,
        status: "DRAFT"
      }
    });
  }
  return prisma.outreachDraft.create({
    data: {
      leadId,
      userId,
      type,
      subject,
      opener: parts.opener,
      pitch: parts.pitch,
      cta: parts.cta,
      fullMessage,
      status: "DRAFT"
    }
  });
}

export async function generateLeadFollowUpDraft(userId, leadId) {
  await markFollowUpDueLeads();
  const lead = await leadContext(leadId);
  const eligibility = followUpEligibility(lead, { requireDue: false });
  if (!eligibility.eligible) throw new HttpError(422, eligibility.reason);
  const step = eligibility.step;
  const initialSend = lead.emailSends.find((item) => item.eventType === "OUTBOUND") || lead.emailSends[0];
  if (!initialSend) throw new HttpError(422, "Initial sent email not found for this lead");
  const report = lead.auditReports?.[0] || null;
  const selectedServices = extractSelectedServices(lead, report);
  const generated = await generateFollowUpCopy({ lead, step, initialSend, selectedServices, report });
  validateFollowUpDraft({ body: generated.fullMessage, subject: generated.subject, initialBody: initialSend.body });
  const draft = await upsertDraft({
    leadId,
    userId,
    type: followUpType(step),
    subject: generated.subject,
    fullMessage: generated.fullMessage
  });
  await prisma.leadNote.create({
    data: { leadId, userId, note: `Generated follow-up ${step} draft.` }
  });
  return {
    leadId,
    step,
    dueAt: lead.nextFollowUpAt,
    draft
  };
}

export async function generateDueFollowUpDrafts(userId) {
  const leads = await listDueFollowUps();
  const summary = { total: leads.length, generated: 0, skipped: 0, failed: 0, skippedReasons: [], failedReasons: [], drafts: [] };
  for (const lead of leads) {
    try {
      const draft = await generateLeadFollowUpDraft(userId, lead.id);
      summary.generated += 1;
      summary.drafts.push(draft);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 422) {
        summary.skipped += 1;
        summary.skippedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message });
      } else {
        summary.failed += 1;
        summary.failedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message || "Draft generation failed" });
      }
    }
  }
  return summary;
}

export async function generateBatchFollowUpDrafts(userId, leadIds = []) {
  const ids = Array.isArray(leadIds) ? leadIds.filter(Boolean) : [];
  if (!ids.length) throw new HttpError(422, "Select at least one lead");
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: { id: true, company: true }
  });
  const summary = { total: leads.length, generated: 0, skipped: 0, failed: 0, skippedReasons: [], failedReasons: [], drafts: [] };
  for (const lead of leads) {
    try {
      const draft = await generateLeadFollowUpDraft(userId, lead.id);
      summary.generated += 1;
      summary.drafts.push(draft);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 422) {
        summary.skipped += 1;
        summary.skippedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message });
      } else {
        summary.failed += 1;
        summary.failedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message || "Draft generation failed" });
      }
    }
  }
  return summary;
}

async function latestDraftForStep(leadId, step) {
  return prisma.outreachDraft.findFirst({
    where: {
      leadId,
      type: followUpType(step),
      status: { in: ["DRAFT", "SAVED", "COPIED", "SENT"] }
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function afterFollowUpSent({ userId, leadId, step, sentAt }) {
  const data = step === 1
    ? {
        followUpStatus: "FOLLOW_UP_1_SENT",
        followUpStep: 1,
        lastFollowUpSentAt: sentAt,
        nextFollowUpAt: nowPlusDays(FOLLOW_UP_2_DELAY_DAYS),
        followUpStoppedReason: null
      }
    : {
        followUpStatus: "COMPLETED",
        followUpStep: 2,
        lastFollowUpSentAt: sentAt,
        nextFollowUpAt: null,
        followUpStoppedReason: "sequence_completed"
      };
  await prisma.lead.update({ where: { id: leadId }, data });
  await prisma.leadNote.create({
    data: { leadId, userId, note: `Sent follow-up ${step}.` }
  });
}

export async function sendLeadFollowUp(userId, leadId, options = {}) {
  await markFollowUpDueLeads();
  const lead = await leadContext(leadId);
  const eligibility = followUpEligibility(lead, { requireDue: options.overrideDue !== true });
  if (!eligibility.eligible) throw new HttpError(422, eligibility.reason);
  const step = eligibility.step;
  const mode = await followUpMode();
  let draft = await latestDraftForStep(leadId, step);
  if (!draft || draft.status === "SENT") {
    if (mode !== "AUTO_SEND") {
      throw new HttpError(422, "Follow-up draft missing. Generate and review the draft before sending.");
    }
    const generated = await generateLeadFollowUpDraft(userId, leadId);
    draft = generated.draft;
  }
  const initialSend = lead.emailSends.find((item) => item.eventType === "OUTBOUND") || lead.emailSends[0];
  validateFollowUpDraft({ body: draft.fullMessage, subject: draft.subject, initialBody: initialSend?.body || "" });
  const sendResult = await sendEmail(userId, {
    leadId,
    outreachDraftId: draft.id,
    toEmail: recipientEmail(lead),
    subject: draft.subject || `Re: ${initialSend?.subject || lead.company}`,
    body: draft.fullMessage,
    includeReport: false,
    emailSelectedServices: extractSelectedServices(lead, lead.auditReports?.[0] || null).map((item) => item.id),
    eventType: followUpType(step),
    gmailThreadId: lead.gmailThreadId || initialSend?.gmailThreadId || null,
    ignoreCooldown: true,
    skipPipelineQualityGate: true,
    allowDuplicate: options.overrideDue === true
  });
  if (sendResult.status !== "SENT") throw new HttpError(422, sendResult.errorMessage || "Follow-up send failed");
  await prisma.outreachDraft.update({ where: { id: draft.id }, data: { status: "SENT" } });
  await afterFollowUpSent({ userId, leadId, step, sentAt: sendResult.sentAt || new Date() });
  return { leadId, step, send: sendResult };
}

export async function sendDueFollowUps(userId) {
  const leads = await listDueFollowUps();
  const mode = await followUpMode();
  const summary = { total: leads.length, sent: 0, skipped: 0, failed: 0, skippedReasons: [], failedReasons: [] };
  for (const lead of leads) {
    try {
      if (mode !== "AUTO_SEND") {
        const existingDraft = await latestDraftForStep(lead.id, followUpStepForLead(lead));
        if (!existingDraft || existingDraft.status === "SENT") {
          throw new HttpError(422, "Draft missing for manual approval mode");
        }
      }
      await sendLeadFollowUp(userId, lead.id);
      summary.sent += 1;
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 422) {
        summary.skipped += 1;
        summary.skippedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message });
      } else {
        summary.failed += 1;
        summary.failedReasons.push({ leadId: lead.id, leadName: lead.company, reason: error.message || "Follow-up send failed" });
      }
    }
  }
  return summary;
}
