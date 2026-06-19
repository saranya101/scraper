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
  const [stats, opportunities, templates, outreachDrafts, recentLeads] = await Promise.all([
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
    })
  ]);

  return {
    industry,
    stats,
    recommendedServices: summarizeServices(opportunities),
    templates: templates.filter((template) => templateMatchesIndustry(template, slug, industry)).slice(0, 6),
    outreachDrafts,
    recentLeads
  };
}
