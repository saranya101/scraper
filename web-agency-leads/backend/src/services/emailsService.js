import { prisma } from "../repositories/prisma.js";
import { HttpError } from "../utils/httpError.js";
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
  const search = String(query.search || "").trim();
  if (query.qualified !== "false") {
    and.push({ OR: [{ priority: { in: ["HOT", "WARM"] } }, { score: { lte: 6 } }, { opportunityScore: { gte: 7 } }] });
  }
  if (search) {
    and.push({
      OR: [
        { company: { contains: search, mode: "insensitive" } },
        { website: { contains: search, mode: "insensitive" } },
        { industry: { contains: search, mode: "insensitive" } },
        { industryRef: { name: { contains: search, mode: "insensitive" } } },
        { generalEmail: { contains: search, mode: "insensitive" } },
        { ownerEmail: { contains: search, mode: "insensitive" } }
      ]
    });
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

export async function sendTest(userId, input = {}) {
  if (!input.testEmail) throw new HttpError(422, "Add a test email address first");
  return emailService.sendEmail(userId, {
    ...input,
    toEmail: input.testEmail,
    body: bodyWithFooter(input.body),
    mode: "MANUAL_APPROVAL",
    testOnly: true,
    ignoreCooldown: true
  });
}

export async function sendBulkApproved(userId, input = {}) {
  void userId;
  void input;
  throw new HttpError(409, "Bulk email sending is disabled in Gmail testing mode");
}

export async function autoSend(userId, input = {}) {
  void userId;
  void input;
  throw new HttpError(409, "Automatic email sending is disabled in Gmail testing mode");
}

export async function getBulkJob(id, userId) {
  void id;
  void userId;
  throw new HttpError(409, "Bulk email sending is disabled in Gmail testing mode");
}

export async function cancelBulkJob(id, userId) {
  void id;
  void userId;
  throw new HttpError(409, "Bulk email sending is disabled in Gmail testing mode");
}
