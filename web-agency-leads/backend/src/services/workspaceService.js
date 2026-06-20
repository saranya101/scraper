import { prisma } from "../repositories/prisma.js";
import { notFound } from "../utils/httpError.js";
import { getStats, industryWorkspaceWhere } from "./leadService.js";
import { getCatalog } from "./serviceOpportunityService.js";

function templateMatchesIndustry(template, slug, industry) {
  const filters = template.filters && typeof template.filters === "object" ? template.filters : {};
  const keyword = `${template.keyword || ""} ${template.name || ""}`.toLowerCase();
  if (filters.industrySlug === slug) return true;
  if (industry?.name && keyword.includes(industry.name.toLowerCase())) return true;
  return keyword.includes(String(slug || "").replaceAll("-", " "));
}

function summarizeServices(opportunities) {
  const map = new Map();
  for (const opportunity of opportunities) {
    const item = map.get(opportunity.serviceId) || {
      service: opportunity.service,
      count: 0,
      averageScore: 0,
      estimatedMinValue: 0,
      estimatedMaxValue: 0
    };
    item.count += 1;
    item.averageScore += opportunity.score;
    item.estimatedMinValue += opportunity.estimatedMinValue;
    item.estimatedMaxValue += opportunity.estimatedMaxValue;
    map.set(opportunity.serviceId, item);
  }

  return Array.from(map.values())
    .map((item) => ({ ...item, averageScore: Math.round(item.averageScore / item.count) }))
    .sort((a, b) => b.count - a.count || b.averageScore - a.averageScore)
    .slice(0, 6);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function healthScore({ stats, leads, outreachCount, pipelineCount, repliedCount, estimatedPipeline }) {
  const total = stats.total || 0;
  const leadQuality = total ? clampScore(((stats.hot || 0) * 100 + (stats.warm || 0) * 60 + (stats.cold || 0) * 25) / total) : 0;
  const outreachCoverage = total ? clampScore((outreachCount / total) * 100) : 0;
  const pipelineHealth = total ? clampScore((pipelineCount / total) * 100) : 0;
  const responseRate = total ? clampScore((repliedCount / Math.max(1, (stats.contacted || 0) + repliedCount)) * 100) : 0;
  const revenuePotential = clampScore(Math.min(100, estimatedPipeline / 500));
  const overall = clampScore((leadQuality + outreachCoverage + pipelineHealth + responseRate + revenuePotential) / 5);

  return {
    overall,
    leadQuality,
    outreachCoverage,
    pipelineHealth,
    responseRate,
    revenuePotential,
    estimatedPipeline,
    sampleLeads: leads.length
  };
}

export async function listWorkspaces() {
  const { industries } = await getCatalog();
  const stats = await Promise.all(
    industries.map(async (industry) => ({
      industry,
      stats: await getStats(industryWorkspaceWhere(industry.slug))
    }))
  );

  return stats;
}

export async function getWorkspace(slug, userId) {
  const { industries } = await getCatalog();
  const industry = industries.find((item) => item.slug === slug) || (slug === "custom" ? { name: "Custom", slug: "custom" } : null);
  if (!industry) throw notFound("Industry workspace not found");

  const where = industryWorkspaceWhere(slug);
  const [stats, opportunities, templates, outreachDrafts, recentLeads, healthLeads, pipelineCount, repliedCount] = await Promise.all([
    getStats(where),
    prisma.serviceOpportunity.findMany({
      where: { recommended: true, lead: where },
      include: { service: true }
    }),
    prisma.scanTemplate.findMany({
      where: { createdBy: userId },
      orderBy: { createdAt: "desc" }
    }),
    prisma.lead.findMany({
      where: { ...where, outreachEmail: { not: null } },
      select: { id: true, company: true, industry: true, outreachEmail: true, priority: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.lead.findMany({
      where,
      select: { id: true, company: true, priority: true, status: true, score: true, opportunityScore: true, website: true },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.lead.findMany({
      where: { ...where, status: { not: "ARCHIVED" } },
      select: { estimatedMinValue: true, estimatedMaxValue: true, actualRevenue: true, serviceOpportunities: { where: { recommended: true }, select: { estimatedMinValue: true, estimatedMaxValue: true } } }
    }),
    prisma.lead.count({ where: { ...where, pipelineStage: { in: ["REPLIED", "MEETING", "PROPOSAL", "WON"] }, status: { not: "ARCHIVED" } } }),
    prisma.lead.count({ where: { ...where, OR: [{ status: "REPLIED" }, { pipelineStage: { in: ["REPLIED", "MEETING", "PROPOSAL", "WON"] } }] } })
  ]);

  const estimatedPipeline = healthLeads.reduce((sum, lead) => {
    if (lead.actualRevenue) return sum + lead.actualRevenue;
    if (lead.estimatedMaxValue || lead.estimatedMinValue) return sum + Number(lead.estimatedMaxValue || lead.estimatedMinValue || 0);
    const recommended = lead.serviceOpportunities?.[0];
    return sum + Number(recommended?.estimatedMaxValue || recommended?.estimatedMinValue || 0);
  }, 0);

  return {
    industry,
    workspaceSections: industry.workspaceSections || { stats: true, recommendedServices: true, scannerTemplates: true, outreachDrafts: true, leads: true },
    stats,
    health: healthScore({ stats, leads: healthLeads, outreachCount: outreachDrafts.length, pipelineCount, repliedCount, estimatedPipeline }),
    recommendedServices: summarizeServices(opportunities),
    templates: templates.filter((template) => templateMatchesIndustry(template, slug, industry)).slice(0, 6),
    outreachDrafts,
    recentLeads
  };
}
