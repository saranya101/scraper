import { prisma } from "../repositories/prisma.js";

function dateRange(query = {}) {
  const where = {};
  if (query.startDate || query.endDate) {
    const endDate = query.endDate ? new Date(query.endDate) : null;
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(query.endDate)) {
      endDate.setHours(23, 59, 59, 999);
    }
    where.createdAt = {
      ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
      ...(endDate ? { lte: endDate } : {})
    };
  }
  return where;
}

function leadWhere(query = {}) {
  return {
    ...dateRange(query),
    ...(query.industry ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
}

function scanWhere(query = {}) {
  return {
    ...dateRange(query),
    ...(query.industry ? { keyword: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {})
  };
}

function percentage(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

function average(items, key) {
  const values = items.map((item) => Number(item[key])).filter((value) => Number.isFinite(value));
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
}

function groupByText(items, key, fallback = "Unknown") {
  const map = new Map();
  for (const item of items) {
    const value = (item[key] || fallback).trim?.() || fallback;
    const current = map.get(value) || [];
    current.push(item);
    map.set(value, current);
  }
  return map;
}

function leadMetrics(items) {
  const total = items.length;
  const hot = items.filter((lead) => lead.priority === "HOT").length;
  const contacted = items.filter((lead) => ["CONTACTED", "REPLIED", "CLOSED"].includes(lead.status) || ["SENT", "REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(lead.pipelineStage)).length;
  const replied = items.filter((lead) => lead.status === "REPLIED" || ["REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(lead.pipelineStage)).length;
  const won = items.filter((lead) => lead.pipelineStage === "WON").length;
  return {
    total,
    hot,
    contacted,
    replied,
    won,
    hotPercentage: percentage(hot, total),
    contactedPercentage: percentage(contacted, total),
    repliedPercentage: percentage(replied, total),
    wonPercentage: percentage(won, total),
    averageOpportunityScore: average(items, "opportunityScore")
  };
}

async function filteredLeads(query = {}) {
  return prisma.lead.findMany({
    where: leadWhere(query),
    include: {
      serviceOpportunities: {
        where: { recommended: true },
        include: { service: true },
        take: 1
      }
    }
  });
}

async function pipelineValue(query = {}) {
  const opportunities = await prisma.serviceOpportunity.findMany({
    where: {
      recommended: true,
      lead: leadWhere(query)
    }
  });
  return opportunities.reduce((sum, item) => sum + Math.round((item.estimatedMinValue + item.estimatedMaxValue) / 2), 0);
}

export async function overview(query = {}) {
  const [leads, scansRun, value] = await Promise.all([
    filteredLeads(query),
    prisma.scanJob.count({ where: scanWhere(query) }),
    pipelineValue(query)
  ]);
  const metrics = leadMetrics(leads);
  return {
    scansRun,
    leadsFound: metrics.total,
    hotLeadPercentage: metrics.hotPercentage,
    contactedPercentage: metrics.contactedPercentage,
    repliedPercentage: metrics.repliedPercentage,
    wonPercentage: metrics.wonPercentage,
    estimatedPipelineValue: value,
    averageOpportunityScore: metrics.averageOpportunityScore
  };
}

function rankedGroupRows(groups, keyName) {
  return Array.from(groups.entries())
    .map(([name, items]) => {
      const metrics = leadMetrics(items);
      const value = items.reduce((sum, lead) => {
        const opportunity = lead.serviceOpportunities?.[0];
        return sum + (opportunity ? Math.round((opportunity.estimatedMinValue + opportunity.estimatedMaxValue) / 2) : 0);
      }, 0);
      const performanceScore = metrics.hotPercentage + metrics.repliedPercentage * 1.5 + metrics.wonPercentage * 2 + metrics.averageOpportunityScore;
      return { [keyName]: name, ...metrics, estimatedPipelineValue: value, performanceScore };
    })
    .sort((a, b) => b.performanceScore - a.performanceScore || b.total - a.total);
}

export async function industries(query = {}) {
  const leads = await filteredLeads(query);
  const rows = rankedGroupRows(groupByText(leads, "industry"), "industry");
  return {
    items: rows,
    best: rows.slice(0, 5),
    worst: [...rows].filter((row) => row.total > 0).sort((a, b) => a.performanceScore - b.performanceScore || b.total - a.total).slice(0, 5)
  };
}

export async function locations(query = {}) {
  const leads = await filteredLeads(query);
  return {
    items: rankedGroupRows(groupByText(leads, "location"), "location")
  };
}

export async function services(query = {}) {
  const opportunities = await prisma.serviceOpportunity.findMany({
    where: {
      recommended: true,
      lead: leadWhere(query)
    },
    include: {
      service: true,
      lead: true
    }
  });
  const map = new Map();
  for (const opportunity of opportunities) {
    const serviceName = opportunity.service.name;
    const current = map.get(serviceName) || [];
    current.push({ ...opportunity.lead, serviceOpportunities: [opportunity] });
    map.set(serviceName, current);
  }
  return {
    items: rankedGroupRows(map, "service")
  };
}

export async function funnel(query = {}) {
  const leads = await filteredLeads(query);
  const total = leads.length;
  const stages = [
    { key: "LEADS", label: "Leads", count: total },
    { key: "HOT", label: "HOT", count: leads.filter((lead) => lead.priority === "HOT").length },
    { key: "CONTACTED", label: "Contacted", count: leads.filter((lead) => ["CONTACTED", "REPLIED", "CLOSED"].includes(lead.status) || ["SENT", "REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(lead.pipelineStage)).length },
    { key: "REPLIED", label: "Replied", count: leads.filter((lead) => lead.status === "REPLIED" || ["REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(lead.pipelineStage)).length },
    { key: "MEETING", label: "Meeting", count: leads.filter((lead) => ["MEETING", "PROPOSAL", "WON"].includes(lead.pipelineStage)).length },
    { key: "PROPOSAL", label: "Proposal", count: leads.filter((lead) => ["PROPOSAL", "WON"].includes(lead.pipelineStage)).length },
    { key: "WON", label: "Won", count: leads.filter((lead) => lead.pipelineStage === "WON").length }
  ];
  return stages.map((stage) => ({ ...stage, percentage: percentage(stage.count, total) }));
}
