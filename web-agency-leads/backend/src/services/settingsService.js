import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { ensureDefaultCatalog } from "./catalogService.js";

const settingDefaults = {
  apiKeys: {
    googlePlacesKey: "",
    openaiKey: ""
  },
  costTracking: {
    googlePlacesCost: 0,
    openAiCost: 0,
    tokensUsed: 0,
    googlePlacesCostPerSearch: 0.017,
    openAiCostPerThousandTokens: 0.01
  },
  darkMode: {
    defaultTheme: "system"
  },
  notifications: {
    hotLeadFound: true,
    scanFailed: true,
    automationCompleted: true,
    highValueLeadFound: true,
    replyReceived: true,
    meetingBooked: true
  }
};

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/,|\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function setting(key) {
  const saved = await prisma.appSetting.findUnique({ where: { key } });
  return saved?.value ?? settingDefaults[key] ?? {};
}

async function upsertSetting(key, value, userId) {
  return prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: userId },
    update: { value, updatedBy: userId }
  });
}

function sanitizeApiKeys(value = {}) {
  return {
    googlePlacesKey: value.googlePlacesKey ? "Saved" : "",
    openaiKey: value.openaiKey ? "Saved" : ""
  };
}

async function costSummary(costTracking) {
  const [scansRun, qualifiedLeads, scanResults] = await Promise.all([
    prisma.scanJob.count(),
    prisma.lead.count({ where: { priority: "HOT", status: { not: "ARCHIVED" } } }),
    prisma.scanResult.count()
  ]);
  const googlePlacesCost = number(costTracking.googlePlacesCost);
  const openAiCost = number(costTracking.openAiCost);
  const totalCost = googlePlacesCost + openAiCost;

  return {
    googlePlacesCost,
    openAiCost,
    tokensUsed: number(costTracking.tokensUsed),
    scansRun,
    websitesAudited: scanResults,
    costPerScan: scansRun ? totalCost / scansRun : 0,
    costPerQualifiedLead: qualifiedLeads ? totalCost / qualifiedLeads : 0
  };
}

export async function getSettings(userId) {
  await ensureDefaultCatalog();
  const [users, industries, services, apiKeys, costTracking, darkMode, notifications] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true }, orderBy: { name: "asc" } }),
    prisma.industry.findMany({ include: { scoringRule: true }, orderBy: { name: "asc" } }),
    prisma.agencyService.findMany({ orderBy: { name: "asc" } }),
    setting("apiKeys"),
    setting("costTracking"),
    setting("darkMode"),
    setting("notifications")
  ]);

  return {
    profile: users.find((user) => user.id === userId),
    users,
    apiKeys: sanitizeApiKeys(apiKeys),
    costTracking,
    costSummary: await costSummary(costTracking),
    darkMode,
    notifications,
    industries,
    services
  };
}

export async function updateProfile(userId, input = {}) {
  const data = {
    ...(input.name ? { name: String(input.name).trim() } : {}),
    ...(input.email ? { email: String(input.email).trim().toLowerCase() } : {})
  };
  if (!Object.keys(data).length) throw new HttpError(422, "Nothing to update");
  return prisma.user.update({ where: { id: userId }, data, select: { id: true, name: true, email: true, role: true } });
}

export async function updateAppSettings(userId, input = {}) {
  const keys = ["apiKeys", "costTracking", "darkMode", "notifications"];
  for (const key of keys) {
    if (input[key] !== undefined) {
      const current = await setting(key);
      const incoming = { ...input[key] };
      if (key === "apiKeys") {
        if (incoming.googlePlacesKey === "Saved") delete incoming.googlePlacesKey;
        if (incoming.openaiKey === "Saved") delete incoming.openaiKey;
      }
      await upsertSetting(key, { ...current, ...incoming }, userId);
    }
  }
  return getSettings(userId);
}

function industryData(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw new HttpError(422, "Industry name is required");
  return {
    name,
    slug: slugify(input.slug || name),
    description: input.description || null,
    defaultKeywords: parseJsonArray(input.defaultKeywords).join(", "),
    auditCriteria: input.auditCriteria || null,
    recommendedServiceIds: parseJsonArray(input.recommendedServiceIds),
    workspaceSections: input.workspaceSections || {
      stats: true,
      recommendedServices: true,
      scannerTemplates: true,
      outreachDrafts: true,
      leads: true
    },
    enabled: input.enabled !== false
  };
}

function ruleData(input = {}) {
  return {
    designWeight: number(input.designWeight, 1),
    mobileWeight: number(input.mobileWeight, 1),
    trustWeight: number(input.trustWeight, 1),
    ctaWeight: number(input.ctaWeight, 1),
    seoWeight: number(input.seoWeight, 1),
    conversionWeight: number(input.conversionWeight, 1),
    bookingWeight: number(input.bookingWeight, 1),
    socialProofWeight: number(input.socialProofWeight, 1)
  };
}

export async function createIndustry(input = {}) {
  const data = industryData(input);
  const industry = await prisma.industry.create({
    data: {
      ...data,
      scoringRule: { create: ruleData(input.scoringRule) }
    },
    include: { scoringRule: true }
  });
  return industry;
}

export async function updateIndustry(id, input = {}) {
  const existing = await prisma.industry.findUnique({ where: { id }, include: { scoringRule: true } });
  if (!existing) throw notFound("Industry not found");
  const data = industryData({ ...existing, ...input });
  return prisma.industry.update({
    where: { id },
    data: {
      ...data,
      scoringRule: {
        upsert: {
          create: ruleData(input.scoringRule || existing.scoringRule),
          update: ruleData(input.scoringRule || existing.scoringRule)
        }
      }
    },
    include: { scoringRule: true }
  });
}

export async function deleteIndustry(id) {
  const leads = await prisma.lead.count({ where: { industryId: id } });
  if (leads) {
    await prisma.industry.update({ where: { id }, data: { enabled: false } });
    return { deleted: false, disabled: true };
  }
  await prisma.industry.delete({ where: { id } });
  return { deleted: true };
}

function serviceData(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw new HttpError(422, "Service name is required");
  return {
    name,
    slug: slugify(input.slug || name),
    description: input.description || null,
    baseMinValue: number(input.baseMinValue, 0),
    baseMaxValue: number(input.baseMaxValue, 0),
    enabled: input.enabled !== false
  };
}

export async function createService(input = {}) {
  return prisma.agencyService.create({ data: serviceData(input) });
}

export async function updateService(id, input = {}) {
  const existing = await prisma.agencyService.findUnique({ where: { id } });
  if (!existing) throw notFound("Service not found");
  return prisma.agencyService.update({ where: { id }, data: serviceData({ ...existing, ...input }) });
}

export async function deleteService(id) {
  const opportunities = await prisma.serviceOpportunity.count({ where: { serviceId: id } });
  if (opportunities) {
    await prisma.agencyService.update({ where: { id }, data: { enabled: false } });
    return { deleted: false, disabled: true };
  }
  await prisma.agencyService.delete({ where: { id } });
  return { deleted: true };
}
