import { prisma } from "../repositories/prisma.js";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function clamp(value, min = 1, max = 10) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function weakness(score, fallback = 7) {
  return 11 - Number(score || fallback);
}

function inferIndustrySlug(lead, industries) {
  const haystack = `${lead.industry || ""} ${lead.company || ""}`.toLowerCase();
  const direct = industries.find((industry) => haystack.includes(industry.name.toLowerCase()));
  if (direct) return direct.slug;
  if (/beauty|aesthetic|salon|spa|nail|lash|skin|wellness/.test(haystack)) return "beauty-aesthetics";
  if (/dental|dentist|orthodont/.test(haystack)) return "dental";
  if (/clinic|medical|health|doctor|gp|specialist/.test(haystack)) return "medical-clinics";
  if (/interior|renovation|design studio/.test(haystack)) return "interior-design";
  if (/contractor|plumb|electric|clean|moving|roof|repair|home/.test(haystack)) return "home-services";
  if (/restaurant|cafe|bar|food|bistro|dining/.test(haystack)) return "restaurants";
  if (/law|legal|attorney|solicitor/.test(haystack)) return "legal";
  return "professional-services";
}

async function getIndustryContext(lead) {
  const industries = await prisma.industry.findMany({ include: { scoringRule: true } });
  const slug = inferIndustrySlug(lead, industries);
  return industries.find((industry) => industry.slug === slug) || industries.find((industry) => industry.slug === "professional-services");
}

function serviceScore(service, lead, rule) {
  const design = weakness(lead.visualDesignScore || lead.score) * Number(rule?.designWeight || 1);
  const mobile = weakness(lead.mobileScore || lead.score) * Number(rule?.mobileWeight || 1);
  const trust = weakness(lead.trustScore || lead.score) * Number(rule?.trustWeight || 1);
  const cta = weakness(lead.ctaScore || lead.score) * Number(rule?.ctaWeight || 1);
  const seo = weakness(lead.seoScore || lead.score) * Number(rule?.seoWeight || 1);
  const conversion = weakness(lead.opportunityScore ? 11 - lead.opportunityScore : lead.score) * Number(rule?.conversionWeight || 1);
  const bookingNeed = /booking|appointment|reservation|clinic|salon|restaurant|dental|beauty|aesthetic/i.test(`${lead.industry || ""} ${lead.company || ""}`)
    ? 8 * Number(rule?.bookingWeight || 1)
    : 4 * Number(rule?.bookingWeight || 1);
  const socialProof = trust * Number(rule?.socialProofWeight || 1);

  const formulas = {
    "website-redesign": design * 0.35 + mobile * 0.2 + trust * 0.15 + cta * 0.15 + conversion * 0.15,
    "landing-page": cta * 0.35 + conversion * 0.3 + design * 0.2 + mobile * 0.15,
    seo: seo * 0.55 + trust * 0.15 + conversion * 0.15 + mobile * 0.15,
    "local-seo": seo * 0.45 + trust * 0.2 + socialProof * 0.2 + mobile * 0.15,
    branding: design * 0.45 + trust * 0.35 + socialProof * 0.2,
    ecommerce: cta * 0.25 + conversion * 0.3 + design * 0.2 + mobile * 0.15 + trust * 0.1,
    "booking-system": bookingNeed * 0.45 + cta * 0.25 + mobile * 0.15 + conversion * 0.15,
    analytics: conversion * 0.35 + cta * 0.25 + seo * 0.2 + trust * 0.2,
    automation: bookingNeed * 0.25 + conversion * 0.35 + cta * 0.2 + trust * 0.2,
    maintenance: weakness(lead.score) * 0.35 + mobile * 0.2 + seo * 0.2 + trust * 0.25
  };

  return clamp(formulas[service.slug] || weakness(lead.score));
}

function reasonFor(service, score, lead, industry) {
  const issue = Array.isArray(lead.issues) && lead.issues[0]?.issueText ? lead.issues[0].issueText : null;
  const industryName = industry?.name || lead.industry || "this industry";
  const base = `${service.name} scores ${score}/10 for ${industryName}`;
  if (service.slug === "booking-system") return `${base} because appointment or enquiry friction can directly reduce conversions.`;
  if (service.slug === "local-seo") return `${base} because local discovery and trust signals are important for nearby buyers.`;
  if (service.slug === "website-redesign") return `${base} based on visual, mobile, trust, and CTA gaps${issue ? ` such as: ${issue}` : "."}`;
  if (service.slug === "branding") return `${base} because stronger credibility and differentiation can lift perceived value.`;
  return `${base} based on the current audit scores and opportunity profile.`;
}

function valueEstimate(service, score) {
  const multiplier = score >= 9 ? 1.25 : score >= 7 ? 1 : score >= 5 ? 0.75 : 0.55;
  return {
    estimatedMinValue: Math.round(service.baseMinValue * multiplier),
    estimatedMaxValue: Math.round(service.baseMaxValue * multiplier)
  };
}

export async function generateForLead(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { issues: true }
  });
  if (!lead) return [];

  const [services, industry] = await Promise.all([
    prisma.agencyService.findMany({ orderBy: { name: "asc" } }),
    getIndustryContext(lead)
  ]);
  const rule = industry?.scoringRule;
  const scored = services
    .map((service) => {
      const score = serviceScore(service, lead, rule);
      const values = valueEstimate(service, score);
      return {
        service,
        data: {
          leadId,
          serviceId: service.id,
          score,
          ...values,
          reason: reasonFor(service, score, lead, industry),
          recommended: false
        }
      };
    })
    .sort((a, b) => b.data.score - a.data.score);

  if (scored[0]) scored[0].data.recommended = true;

  await prisma.serviceOpportunity.deleteMany({ where: { leadId } });
  for (const item of scored) {
    await prisma.serviceOpportunity.create({ data: item.data });
  }

  return prisma.serviceOpportunity.findMany({
    where: { leadId },
    include: { service: true },
    orderBy: [{ recommended: "desc" }, { score: "desc" }]
  });
}

export async function generateForAllLeads() {
  const leads = await prisma.lead.findMany({ select: { id: true } });
  let processed = 0;
  for (const lead of leads) {
    await generateForLead(lead.id);
    processed += 1;
  }
  return { processed };
}

export async function getCatalog() {
  const [industries, services] = await Promise.all([
    prisma.industry.findMany({ include: { scoringRule: true }, orderBy: { name: "asc" } }),
    prisma.agencyService.findMany({ orderBy: { name: "asc" } })
  ]);
  return { industries, services };
}

export async function industryRuleSummary(leadLike) {
  const industry = await getIndustryContext(leadLike);
  if (!industry?.scoringRule) return "Use balanced scoring across design, mobile, trust, CTA, SEO, conversion, booking, and social proof.";
  const rule = industry.scoringRule;
  return `Industry profile: ${industry.name}. Weights: design ${rule.designWeight}, mobile ${rule.mobileWeight}, trust ${rule.trustWeight}, CTA ${rule.ctaWeight}, SEO ${rule.seoWeight}, conversion ${rule.conversionWeight}, booking ${rule.bookingWeight}, social proof ${rule.socialProofWeight}.`;
}
