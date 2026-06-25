import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { normalizeWebsite, priorityFromAudit } from "../utils/priority.js";
import { ensureDefaultCatalog } from "./catalogService.js";
import * as serviceOpportunityService from "./serviceOpportunityService.js";

const includeLead = {
  industryRef: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  issues: { orderBy: { createdAt: "asc" } },
  notes: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  },
  statusHistory: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  },
  screenshots: { orderBy: { createdAt: "desc" } },
  serviceOpportunities: {
    include: { service: true },
    orderBy: [{ recommended: "desc" }, { score: "desc" }]
  },
  evidenceCorrections: {
    orderBy: { updatedAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  }
};

const industryWorkspaceTerms = {
  "beauty-aesthetics": ["beauty", "aesthetic", "aesthetics", "salon", "spa", "nail", "lash", "skin", "wellness"],
  dental: ["dental", "dentist", "orthodont"],
  "medical-clinics": ["medical", "clinic", "clinics", "health", "doctor", "gp", "specialist"],
  "interior-design": ["interior", "renovation", "design studio", "home design"],
  "home-services": ["home services", "contractor", "plumb", "electric", "clean", "moving", "roof", "repair", "hvac"],
  restaurants: ["restaurant", "cafe", "bar", "food", "bistro", "dining"],
  legal: ["legal", "law", "lawyer", "attorney", "solicitor"],
  "professional-services": ["professional services", "consultant", "accounting", "finance", "agency", "advisor"],
  custom: ["custom"]
};

export const pipelineStages = ["NOT_CONTACTED", "DRAFTED", "SENT", "REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"];

export function inferIndustrySlug(value = "") {
  const haystack = String(value || "").toLowerCase();
  if (/beauty|aesthetic|aesthetics|salon|\bspa\b|\bspas\b|nail|lash|skin|wellness/.test(haystack)) return "beauty-aesthetics";
  if (/dental|dentist|orthodont/.test(haystack)) return "dental";
  if (/clinic|medical|health|doctor|gp|specialist/.test(haystack)) return "medical-clinics";
  if (/interior|renovation|design studio|home design/.test(haystack)) return "interior-design";
  if (/home services|contractor|plumb|electric|clean|moving|roof|repair|hvac/.test(haystack)) return "home-services";
  if (/restaurant|cafe|bar|food|bistro|dining/.test(haystack)) return "restaurants";
  if (/legal|law|lawyer|attorney|solicitor/.test(haystack)) return "legal";
  return "professional-services";
}

export async function resolveIndustryId(input = {}) {
  if (input.industryId) return input.industryId;
  const label = input.industry || input.company;
  if (!label) return null;
  await ensureDefaultCatalog();
  const industries = await prisma.industry.findMany();
  const normalized = String(label).toLowerCase();
  const direct = industries.find((industry) => normalized.includes(industry.name.toLowerCase()) || normalized.includes(industry.slug.replaceAll("-", " ")));
  const industry = direct || industries.find((item) => item.slug === inferIndustrySlug(`${input.industry || ""} ${input.company || ""}`));
  return industry?.id || null;
}

function statusFromStage(stage) {
  if (stage === "NOT_CONTACTED" || stage === "DRAFTED") return "NOT_CONTACTED";
  if (stage === "REPLIED" || stage === "MEETING" || stage === "PROPOSAL") return "REPLIED";
  if (stage === "WON" || stage === "LOST") return "CLOSED";
  return "CONTACTED";
}

export function industryWorkspaceWhere(slug) {
  const terms = industryWorkspaceTerms[slug];
  if (!terms?.length) return { industryRef: { slug } };
  return {
    OR: [
      { industryRef: { slug } },
      ...terms.flatMap((term) => [
        { industry: { contains: term, mode: "insensitive" } },
        { company: { contains: term, mode: "insensitive" } }
      ])
    ]
  };
}

async function leadData(input) {
  const score = Number(input.score ?? 7);
  const industryId = await resolveIndustryId(input);
  return {
    company: input.company,
    website: normalizeWebsite(input.website),
    phone: input.phone || null,
    address: input.address || null,
    industry: input.industry || null,
    industryId,
    location: input.location || null,
    screenshotPath: input.screenshotPath || null,
    mobileScreenshotPath: input.mobileScreenshotPath || null,
    score,
    visualDesignScore: input.visualDesignScore == null ? null : Number(input.visualDesignScore),
    mobileScore: input.mobileScore == null ? null : Number(input.mobileScore),
    trustScore: input.trustScore == null ? null : Number(input.trustScore),
    ctaScore: input.ctaScore == null ? null : Number(input.ctaScore),
    seoScore: input.seoScore == null ? null : Number(input.seoScore),
    conversionScore: input.conversionScore == null ? null : Number(input.conversionScore),
    speedScore: input.speedScore == null ? null : Number(input.speedScore),
    bookingScore: input.bookingScore == null ? null : Number(input.bookingScore),
    analyticsScore: input.analyticsScore == null ? null : Number(input.analyticsScore),
    contactabilityScore: input.contactabilityScore == null ? null : Number(input.contactabilityScore),
    opportunityScore: input.opportunityScore == null ? null : Number(input.opportunityScore),
    estimatedMinValue: input.estimatedMinValue == null ? null : Number(input.estimatedMinValue),
    estimatedMaxValue: input.estimatedMaxValue == null ? null : Number(input.estimatedMaxValue),
    actualRevenue: input.actualRevenue == null ? null : Number(input.actualRevenue),
    profit: input.profit == null ? null : Number(input.profit),
    monthlyRetainer: input.monthlyRetainer == null ? null : Number(input.monthlyRetainer),
    annualRetainer: input.annualRetainer == null ? null : Number(input.annualRetainer),
    paymentStatus: input.paymentStatus || null,
    wonAt: input.wonAt ? new Date(input.wonAt) : null,
    estimatedProjectValue: input.estimatedProjectValue || null,
    priority: input.priority || priorityFromAudit(score, input.opportunityScore),
    outreachEmail: input.outreachEmail || null,
    status: input.status || "NOT_CONTACTED",
    pipelineStage: input.pipelineStage || (input.status ? (input.status === "REPLIED" ? "REPLIED" : input.status === "CLOSED" ? "WON" : "NOT_CONTACTED") : "NOT_CONTACTED"),
    assignedToUserId: input.assignedToUserId || null,
    reminderDate: input.reminderDate || null,
    websiteStatus: input.websiteStatus || "UNKNOWN",
    statusCode: input.statusCode == null ? null : Number(input.statusCode),
    accessIssue: input.accessIssue || null,
    accessIssueReason: input.accessIssueReason || null,
    lastCheckedAt: input.lastCheckedAt || null,
    cms: input.cms || null,
    analyticsGa4: Boolean(input.analyticsGa4),
    analyticsGtm: Boolean(input.analyticsGtm),
    analyticsMetaPixel: Boolean(input.analyticsMetaPixel),
    bookingCalendly: Boolean(input.bookingCalendly),
    bookingSimplyBook: Boolean(input.bookingSimplyBook),
    bookingAcuity: Boolean(input.bookingAcuity),
    marketingMailchimp: Boolean(input.marketingMailchimp),
    marketingHubspot: Boolean(input.marketingHubspot),
    marketingKlaviyo: Boolean(input.marketingKlaviyo),
    chatIntercom: Boolean(input.chatIntercom),
    chatTawk: Boolean(input.chatTawk),
    chatZendesk: Boolean(input.chatZendesk),
    generalEmail: input.generalEmail || null,
    ownerEmail: input.ownerEmail || null,
    linkedinCompany: input.linkedinCompany || null,
    instagram: input.instagram || null,
    facebook: input.facebook || null,
    whatsapp: input.whatsapp || null,
    contactConfidence: input.contactConfidence == null ? null : Number(input.contactConfidence),
    contactSource: input.contactSource || null,
    recommendedFixes: input.recommendedFixes || undefined
  };
}

export async function listLeads(query) {
  const page = Math.max(Number(query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || 12), 1), 100);
  const search = query.search?.trim();
  const and = [];
  if (query.industrySlug) and.push(industryWorkspaceWhere(query.industrySlug));
  if (search) {
    and.push({
      OR: [
        { company: { contains: search, mode: "insensitive" } },
        { industry: { contains: search, mode: "insensitive" } },
        { industryRef: { name: { contains: search, mode: "insensitive" } } },
        { location: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { website: { contains: search, mode: "insensitive" } },
        { notes: { some: { note: { contains: search, mode: "insensitive" } } } },
        { issues: { some: { issueText: { contains: search, mode: "insensitive" } } } }
      ]
    });
  }
  const where = {
    ...(and.length ? { AND: and } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.pipelineStage ? { pipelineStage: query.pipelineStage } : {}),
    ...(query.assignedToUserId === "unassigned" ? { assignedToUserId: null } : {}),
    ...(query.assignedToUserId && query.assignedToUserId !== "unassigned" ? { assignedToUserId: query.assignedToUserId } : {}),
    ...(query.reminders === "due" ? { reminderDate: { lte: new Date() } } : {}),
    ...(query.reminders === "upcoming" ? { reminderDate: { gt: new Date() } } : {}),
    ...(query.websiteStatus ? { websiteStatus: query.websiteStatus } : {}),
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.industry && !query.industryId ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId } } } : {}),
    ...(query.recommendedServiceId ? { serviceOpportunities: { some: { serviceId: query.recommendedServiceId, recommended: true } } } : {}),
    ...(query.minServiceScore ? { serviceOpportunities: { some: { score: { gte: Number(query.minServiceScore) } } } } : {}),
    ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
    ...(query.hasPhone === "true" ? { phone: { not: null } } : {}),
    ...(query.hasScreenshot === "true" ? { screenshotPath: { not: null } } : {}),
    ...(query.missingAnalytics === "true" ? { analyticsGa4: false, analyticsGtm: false } : {}),
    ...(query.missingBooking === "true" ? { bookingCalendly: false, bookingSimplyBook: false, bookingAcuity: false } : {}),
    ...(query.cms ? { cms: query.cms } : {}),
    ...(query.withoutMetaPixel === "true" ? { analyticsMetaPixel: false } : {}),
    ...(query.minScore ? { score: { gte: Number(query.minScore) } } : {}),
    ...(query.maxScore ? { score: { ...(query.minScore ? { gte: Number(query.minScore) } : {}), lte: Number(query.maxScore) } } : {})
  };

  const sortBy = ["company", "score", "opportunityScore", "priority", "status", "createdAt", "updatedAt"].includes(query.sortBy)
    ? query.sortBy
    : "createdAt";
  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

  const [items, total, stats] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        industryRef: true,
        issues: true,
        serviceOpportunities: {
          where: { recommended: true },
          include: { service: true },
          take: 1
        },
        assignedTo: { select: { id: true, name: true, email: true } },
        _count: { select: { notes: true } }
      }
    }),
    prisma.lead.count({ where }),
    getStats(where)
  ]);

  return {
    items,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    stats
  };
}

export async function getStats(scope = {}) {
  const activeScope = { ...scope, status: { not: "ARCHIVED" } };
  const [total, byPriority, byStatus, remindersDue] = await Promise.all([
    prisma.lead.count({ where: activeScope }),
    prisma.lead.groupBy({ by: ["priority"], _count: true, where: activeScope }),
    prisma.lead.groupBy({ by: ["status"], _count: true, where: scope }),
    prisma.lead.count({ where: { ...activeScope, reminderDate: { lte: new Date() } } })
  ]);

  return {
    total,
    hot: byPriority.find((row) => row.priority === "HOT")?._count || 0,
    warm: byPriority.find((row) => row.priority === "WARM")?._count || 0,
    cold: byPriority.find((row) => row.priority === "COLD")?._count || 0,
    contacted: byStatus.find((row) => row.status === "CONTACTED")?._count || 0,
    replied: byStatus.find((row) => row.status === "REPLIED")?._count || 0,
    remindersDue
  };
}

export async function listPipeline(query = {}) {
  const params = { ...query, pageSize: 100, sortBy: "updatedAt", sortOrder: "desc" };
  const { items } = await listLeads(params);
  const columns = pipelineStages.map((stage) => ({
    stage,
    leads: items.filter((lead) => lead.pipelineStage === stage)
  }));
  return { stages: pipelineStages, columns };
}

export async function getLead(id) {
  let lead = await prisma.lead.findUnique({ where: { id }, include: includeLead });
  if (!lead) throw notFound("Lead not found");
  if (!lead.serviceOpportunities?.length) {
    await serviceOpportunityService.generateForLead(id);
    lead = await prisma.lead.findUnique({ where: { id }, include: includeLead });
  }
  return lead;
}

export async function createLead(input) {
  const data = await leadData(input);
  const issues = Array.isArray(input.issues) ? input.issues.filter(Boolean) : [];
  try {
    const lead = await prisma.lead.create({
      data: {
        ...data,
        issues: { create: issues.map((issueText) => ({ issueText })) },
        screenshots: {
          create: [
            data.screenshotPath ? { imagePath: data.screenshotPath, type: "DESKTOP" } : null,
            data.mobileScreenshotPath ? { imagePath: data.mobileScreenshotPath, type: "MOBILE" } : null
          ].filter(Boolean)
        }
      },
      include: includeLead
    });
    await serviceOpportunityService.generateForLead(lead.id);
    return getLead(lead.id);
  } catch (error) {
    if (error.code === "P2002") throw new HttpError(409, "A lead with this website already exists");
    throw error;
  }
}

export async function updateLead(id, input, userId) {
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) throw notFound("Lead not found");

  const data = await leadData({ ...current, ...input });
  const statusChanged = input.status && input.status !== current.status;

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id },
      data,
      include: includeLead
    });

    if (statusChanged) {
      await tx.leadStatusHistory.create({
        data: { leadId: id, userId, oldStatus: current.status, newStatus: input.status }
      });
    }

    if (Array.isArray(input.issues)) {
      await tx.leadIssue.deleteMany({ where: { leadId: id } });
      await tx.leadIssue.createMany({
        data: input.issues.filter(Boolean).map((issueText) => ({ leadId: id, issueText }))
      });
    }

    const updated = await tx.lead.findUnique({ where: { id }, include: includeLead });
    return updated;
  });
  await serviceOpportunityService.generateForLead(id);
  return getLead(id);
}

export async function updateStage(id, stage, userId) {
  if (!pipelineStages.includes(stage)) throw new HttpError(422, "Invalid pipeline stage");
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) throw notFound("Lead not found");

  const nextStatus = statusFromStage(stage);
  const lead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { pipelineStage: stage, status: nextStatus },
      include: includeLead
    });

    await tx.leadStatusHistory.create({
      data: {
        leadId: id,
        userId,
        oldStatus: current.status,
        newStatus: nextStatus,
        oldStage: current.pipelineStage,
        newStage: stage
      }
    });

    return updated;
  });

  return lead;
}

export async function assignLead(id, assignedToUserId, userId) {
  await getLead(id);
  if (assignedToUserId) {
    const user = await prisma.user.findUnique({ where: { id: assignedToUserId } });
    if (!user) throw notFound("Owner not found");
  }
  const lead = await prisma.lead.update({
    where: { id },
    data: { assignedToUserId: assignedToUserId || null },
    include: includeLead
  });
  await prisma.leadNote.create({
    data: {
      leadId: id,
      userId,
      note: assignedToUserId ? `Assigned lead to ${lead.assignedTo?.name || "owner"}.` : "Removed lead owner."
    }
  });
  return lead;
}

export async function setReminder(id, reminderDate, userId) {
  await getLead(id);
  const lead = await prisma.lead.update({
    where: { id },
    data: { reminderDate: reminderDate ? new Date(reminderDate) : null },
    include: includeLead
  });
  await prisma.leadNote.create({
    data: {
      leadId: id,
      userId,
      note: reminderDate ? `Reminder set for ${new Date(reminderDate).toISOString()}.` : "Reminder cleared."
    }
  });
  return lead;
}

export async function bulkUpdate(input, userId) {
  const ids = Array.isArray(input.leadIds) ? input.leadIds.filter(Boolean) : [];
  if (!ids.length) throw new HttpError(422, "Select at least one lead");
  const data = {};
  if (input.pipelineStage) {
    if (!pipelineStages.includes(input.pipelineStage)) throw new HttpError(422, "Invalid pipeline stage");
    data.pipelineStage = input.pipelineStage;
    data.status = statusFromStage(input.pipelineStage);
  }
  if (input.status) {
    data.status = input.status;
    if (input.status === "ARCHIVED") data.pipelineStage = "LOST";
  }
  if (Object.prototype.hasOwnProperty.call(input, "assignedToUserId")) data.assignedToUserId = input.assignedToUserId || null;
  if (Object.prototype.hasOwnProperty.call(input, "reminderDate")) data.reminderDate = input.reminderDate ? new Date(input.reminderDate) : null;
  if (!Object.keys(data).length) throw new HttpError(422, "No update selected");

  const leads = await prisma.lead.findMany({ where: { id: { in: ids } } });
  await prisma.$transaction(async (tx) => {
    await tx.lead.updateMany({ where: { id: { in: ids } }, data });
    if (input.pipelineStage) {
      await tx.leadStatusHistory.createMany({
        data: leads.map((lead) => ({
          leadId: lead.id,
          userId,
          oldStatus: lead.status,
          newStatus: data.status,
          oldStage: lead.pipelineStage,
          newStage: input.pipelineStage
        }))
      });
    }
    if (input.status) {
      await tx.leadStatusHistory.createMany({
        data: leads.map((lead) => ({
          leadId: lead.id,
          userId,
          oldStatus: lead.status,
          newStatus: input.status,
          oldStage: lead.pipelineStage,
          newStage: data.pipelineStage || lead.pipelineStage
        }))
      });
    }
  });

  return { updated: leads.length };
}

export async function bulkDelete(input) {
  const ids = Array.isArray(input.leadIds) ? input.leadIds.filter(Boolean) : [];
  if (!ids.length) throw new HttpError(422, "Select at least one lead");
  const result = await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  return { deleted: result.count };
}

export async function deleteLead(id) {
  await getLead(id);
  await prisma.lead.delete({ where: { id } });
}

export async function addNote({ leadId, userId, note }) {
  await getLead(leadId);
  return prisma.leadNote.create({
    data: { leadId, userId, note },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

export async function listNotes(leadId) {
  return prisma.leadNote.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

export async function updateNote(id, userId, note) {
  const existing = await prisma.leadNote.findUnique({ where: { id } });
  if (!existing) throw notFound("Note not found");
  return prisma.leadNote.update({
    where: { id },
    data: { note },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

export async function deleteNote(id) {
  const existing = await prisma.leadNote.findUnique({ where: { id } });
  if (!existing) throw notFound("Note not found");
  await prisma.leadNote.delete({ where: { id } });
}

export async function reprocessOpportunities(id) {
  await getLead(id);
  return serviceOpportunityService.generateForLead(id);
}

export async function reprocessAllOpportunities() {
  return serviceOpportunityService.generateForAllLeads();
}

export async function getMeta() {
  const [catalog, users] = await Promise.all([
    serviceOpportunityService.getCatalog(),
    prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } })
  ]);
  return { ...catalog, users, pipelineStages };
}

export async function syncLeadIndustries(force = false) {
  const leads = await prisma.lead.findMany({ select: { id: true, company: true, industry: true, industryId: true } });
  let linked = 0;
  for (const lead of leads) {
    if (lead.industryId && !force) continue;
    const industryId = await resolveIndustryId({ company: lead.company, industry: lead.industry });
    if (!industryId) continue;
    await prisma.lead.update({ where: { id: lead.id }, data: { industryId } });
    linked += 1;
  }
  return { linked };
}
