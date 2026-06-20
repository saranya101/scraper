import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import * as emailService from "./emailService.js";
import * as outreachService from "./outreachService.js";

const footer = "\n\n--\nIf this is not relevant, feel free to ignore this note.";

function recipientEmail(lead) {
  return lead.ownerEmail || lead.generalEmail || "";
}

function emailStatus(lead) {
  if (lead.emailStatus) return lead.emailStatus;
  if (lead.lastEmailSentAt) return "SENT";
  if (lead.status === "CONTACTED" || lead.pipelineStage === "SENT") return "CONTACTED";
  return "NOT_SENT";
}

function leadRow(lead) {
  const recommended = lead.serviceOpportunities?.[0];
  return {
    ...lead,
    contactEmail: recipientEmail(lead),
    emailStatus: emailStatus(lead),
    recommendedService: recommended?.service || null,
    recommendedServiceReason: recommended?.reason || "",
    estimatedValue: lead.estimatedMaxValue || lead.estimatedMinValue || recommended?.estimatedMaxValue || recommended?.estimatedMinValue || null,
    lastEmailSend: lead.emailSends?.[0] || null
  };
}

function whereFromQuery(query = {}) {
  const and = [{ status: { not: "ARCHIVED" } }];
  if (query.qualified !== "false") {
    and.push({ OR: [{ priority: { in: ["HOT", "WARM"] } }, { score: { lte: 6 } }, { opportunityScore: { gte: 7 } }] });
  }
  if (query.minScore) and.push({ score: { gte: Number(query.minScore) } });
  if (query.maxScore) and.push({ score: { lte: Number(query.maxScore) } });
  if (query.industryId) and.push({ industryId: query.industryId });
  if (query.recommendedServiceId) and.push({ serviceOpportunities: { some: { serviceId: query.recommendedServiceId, recommended: true } } });
  if (query.priority) and.push({ priority: query.priority });
  if (query.hasEmailOnly === "true") and.push({ OR: [{ generalEmail: { not: null } }, { ownerEmail: { not: null } }] });
  if (query.contactState === "not_contacted") and.push({ lastEmailSentAt: null, pipelineStage: { not: "SENT" } });
  if (query.contactState === "contacted") and.push({ OR: [{ lastEmailSentAt: { not: null } }, { pipelineStage: "SENT" }] });
  if (query.missingBooking === "true") and.push({ bookingCalendly: false, bookingSimplyBook: false, bookingAcuity: false });
  if (query.missingAnalytics === "true") and.push({ analyticsGa4: false, analyticsGtm: false });
  if (query.withoutMetaPixel === "true") and.push({ analyticsMetaPixel: false });
  return { AND: and };
}

export async function listQualifiedLeads(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || 50), 1), 100);
  const where = whereFromQuery(query);
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ priority: "asc" }, { opportunityScore: "desc" }, { score: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        industryRef: true,
        issues: { orderBy: { createdAt: "asc" }, take: 3 },
        serviceOpportunities: { where: { recommended: true }, include: { service: true }, take: 1 },
        emailSends: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    }),
    prisma.lead.count({ where })
  ]);
  return {
    items: items.map(leadRow),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  };
}

function bodyWithFooter(body) {
  return String(body || "").includes("If this is not relevant") ? body : `${body}${footer}`;
}

export async function generateEmails(userId, input = {}) {
  const leadIds = Array.isArray(input.leadIds) ? input.leadIds.filter(Boolean) : [input.leadId].filter(Boolean);
  if (!leadIds.length) throw new HttpError(422, "Select at least one lead");
  const drafts = [];
  for (const leadId of leadIds) {
    const draft = await outreachService.generateDraft(leadId, userId, { type: "EMAIL", tone: input.tone || "professional, concise" });
    drafts.push({ ...draft, fullMessage: bodyWithFooter(draft.fullMessage) });
  }
  return { drafts };
}

export async function sendOne(userId, input = {}) {
  return emailService.sendEmail(userId, {
    ...input,
    body: bodyWithFooter(input.body),
    mode: input.mode || "MANUAL_APPROVAL"
  });
}

export async function sendBulkApproved(userId, input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new HttpError(422, "Add at least one approved email");
  const results = [];
  for (const item of items) {
    const result = await sendOne(userId, { ...item, emailAccountId: input.emailAccountId, mode: "MANUAL_APPROVAL" }).catch((error) => ({
      leadId: item.leadId,
      status: "FAILED",
      errorMessage: error.message
    }));
    results.push(result);
  }
  return { results };
}

async function appendJobLog(jobId, message) {
  const job = await prisma.emailBulkJob.findUnique({ where: { id: jobId } });
  const logs = Array.isArray(job?.logs) ? job.logs : [];
  logs.push({ at: new Date().toISOString(), message });
  await prisma.emailBulkJob.update({ where: { id: jobId }, data: { logs } }).catch(() => {});
}

async function skipLead({ jobId, userId, accountId, lead, reason }) {
  await prisma.emailSend.create({
    data: {
      leadId: lead.id,
      userId,
      emailAccountId: accountId,
      toEmail: recipientEmail(lead),
      subject: "",
      body: "",
      mode: "AUTO_SEND",
      status: "SKIPPED",
      errorMessage: reason
    }
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { emailStatus: "SKIPPED" } }).catch(() => {});
  await prisma.emailBulkJob.update({ where: { id: jobId }, data: { skippedCount: { increment: 1 } } });
  await appendJobLog(jobId, `Skipped ${lead.company}: ${reason}`);
}

async function processAutoJob(jobId, leadIds, userId, emailAccountId) {
  await prisma.emailBulkJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
  for (const leadId of leadIds) {
    const job = await prisma.emailBulkJob.findUnique({ where: { id: jobId } });
    if (!job || job.status === "CANCELLED") {
      await appendJobLog(jobId, "Bulk job cancelled.");
      return;
    }
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { issues: true, serviceOpportunities: { where: { recommended: true }, include: { service: true }, take: 1 } }
    });
    if (!lead) continue;
    await prisma.emailBulkJob.update({ where: { id: jobId }, data: { currentLeadId: lead.id } });
    const toEmail = recipientEmail(lead);
    if (!toEmail) {
      await skipLead({ jobId, userId, accountId: emailAccountId, lead, reason: "No recipient email" });
      continue;
    }
    try {
      const draft = (await generateEmails(userId, { leadId })).drafts[0];
      const send = await sendOne(userId, {
        leadId,
        outreachDraftId: draft.id,
        emailAccountId,
        toEmail,
        subject: draft.subject || `Quick idea for ${lead.company}`,
        body: draft.fullMessage,
        mode: "AUTO_SEND"
      });
      if (send.status === "SENT") {
        await prisma.emailBulkJob.update({ where: { id: jobId }, data: { sentCount: { increment: 1 } } });
        await appendJobLog(jobId, `Sent ${lead.company}.`);
      } else {
        await prisma.emailBulkJob.update({ where: { id: jobId }, data: { failedCount: { increment: 1 } } });
        await appendJobLog(jobId, `Failed ${lead.company}: ${send.errorMessage || "Unknown error"}`);
      }
    } catch (error) {
      await prisma.emailBulkJob.update({ where: { id: jobId }, data: { failedCount: { increment: 1 } } });
      await appendJobLog(jobId, `Failed ${lead.company}: ${error.message}`);
    }
  }
  await prisma.emailBulkJob.update({ where: { id: jobId }, data: { status: "COMPLETED", currentLeadId: null, completedAt: new Date() } });
}

export async function autoSend(userId, input = {}) {
  const leadIds = Array.isArray(input.leadIds) ? input.leadIds.filter(Boolean) : [];
  if (!leadIds.length) throw new HttpError(422, "Select at least one lead");
  const account = input.emailAccountId
    ? await prisma.emailAccount.findFirst({ where: { id: input.emailAccountId, userId } })
    : await prisma.emailAccount.findFirst({ where: { userId }, orderBy: { connectedAt: "desc" } });
  if (!account) throw new HttpError(422, "Connect Gmail or Outlook before sending");

  const limit = await emailService.getDailyLimit(userId);
  if (limit.remaining <= 0) throw new HttpError(429, `Daily email send limit reached (${limit.limit})`);

  const job = await prisma.emailBulkJob.create({
    data: {
      userId,
      emailAccountId: account.id,
      mode: "AUTO_SEND",
      totalLeads: leadIds.length,
      status: "PENDING",
      logs: [{ at: new Date().toISOString(), message: `Auto-send queued for ${leadIds.length} leads.` }]
    }
  });
  setTimeout(() => processAutoJob(job.id, leadIds, userId, account.id).catch(async (error) => {
    await prisma.emailBulkJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date() } }).catch(() => {});
    await appendJobLog(job.id, `Job failed: ${error.message}`);
  }), 0);
  return job;
}

export async function getBulkJob(id, userId) {
  const job = await prisma.emailBulkJob.findFirst({ where: { id, userId } });
  if (!job) throw notFound("Email bulk job not found");
  return job;
}

export async function cancelBulkJob(id, userId) {
  const job = await prisma.emailBulkJob.findFirst({ where: { id, userId } });
  if (!job) throw notFound("Email bulk job not found");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
  return prisma.emailBulkJob.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date() } });
}
