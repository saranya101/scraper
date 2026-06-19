import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { notFound } from "../utils/httpError.js";
import { normalizeWebsiteRoot, websiteDomainKey } from "../utils/priority.js";
import { searchGooglePlaces } from "./placesService.js";
import { createBrowser, scanWebsite } from "./websiteScannerService.js";

function asList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function fallbackAudit(capture) {
  const strengths = [];
  const weaknesses = [];
  if (capture.websiteStatus === "WORKING") strengths.push("Website is reachable");
  else weaknesses.push(capture.accessIssueReason || capture.accessIssue || "Website access issue");
  if (capture.sslValid) strengths.push("SSL is active");
  else weaknesses.push("SSL or browser security issue");
  if ((capture.extracted?.ctas || []).length) strengths.push("Clear call-to-action buttons");
  else weaknesses.push("Weak or missing call-to-action buttons");
  if ((capture.extracted?.forms || []).length) strengths.push("Lead capture forms are visible");
  if ((capture.extracted?.socialLinks || []).length) strengths.push("Social proof links are visible");
  if (capture.loadTime && capture.loadTime < 3000) strengths.push("Fast initial page load");
  if (capture.loadTime && capture.loadTime >= 5000) weaknesses.push("Slow initial page load");

  const score = Math.min(10, Math.max(1, 5 + strengths.length - weaknesses.length));
  return { score, strengths: strengths.slice(0, 5), weaknesses: weaknesses.slice(0, 5) };
}

async function auditCompetitorWithOpenAI(lead, business, capture) {
  if (!process.env.OPENAI_API_KEY) return fallbackAudit(capture);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `Audit this competitor website compared with the lead.

Lead: ${lead.company}
Lead industry: ${lead.industry || "Unknown"}
Lead score: ${lead.score}/10
Competitor: ${business.company}
Competitor website status: ${capture.websiteStatus}
Competitor visible text:
${capture.visibleText?.slice(0, 7000) || "No text captured."}

Return strict JSON:
{
  "score": 1-10,
  "strengths": ["specific competitor strengths"],
  "weaknesses": ["specific competitor weaknesses"]
}
Higher score means stronger website and online conversion experience.`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a senior website conversion auditor. Return only valid JSON." },
      { role: "user", content: prompt }
    ],
    temperature: 0.25
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  return {
    score: Math.min(10, Math.max(1, Number(parsed.score || fallbackAudit(capture).score))),
    strengths: asList(parsed.strengths).slice(0, 5),
    weaknesses: asList(parsed.weaknesses).slice(0, 5)
  };
}

async function getLead(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      issues: { orderBy: { createdAt: "asc" } },
      competitors: { orderBy: { score: "desc" } },
      serviceOpportunities: {
        where: { recommended: true },
        include: { service: true },
        take: 1
      }
    }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

function compareAngle(lead, competitors) {
  if (!competitors.length) return "Find and audit competitors to generate a comparison-based sales angle.";
  const strengths = [...new Set(competitors.flatMap((competitor) => asList(competitor.strengths)))].slice(0, 4);
  const topScore = Math.max(...competitors.map((competitor) => Number(competitor.score || 0)));
  const recommendedService = lead.serviceOpportunities?.[0]?.service?.name || "website improvements";
  const leadIssues = lead.issues?.map((issue) => issue.issueText).slice(0, 2).join(", ");
  const advantage = strengths.length ? strengths.join(", ").toLowerCase() : "stronger trust signals and clearer conversion paths";
  return `Your competitors are scoring up to ${topScore}/10 and show ${advantage}. Your site can close that gap with ${recommendedService}${leadIssues ? `, especially around ${leadIssues}` : ""}.`;
}

export async function listCompetitors(leadId) {
  const lead = await getLead(leadId);
  return {
    competitors: lead.competitors,
    salesAngle: compareAngle(lead, lead.competitors),
    leadScore: lead.score
  };
}

export async function findCompetitors(leadId) {
  const lead = await getLead(leadId);
  const leadDomain = websiteDomainKey(lead.website);
  const businesses = await searchGooglePlaces({
    keyword: lead.industry || lead.company,
    location: lead.location || lead.address || "",
    maxResults: 10,
    hasWebsiteOnly: true,
    minReviews: 0,
    filters: {}
  });

  const candidates = businesses
    .filter((business) => websiteDomainKey(business.website) && websiteDomainKey(business.website) !== leadDomain)
    .filter((business) => business.company.toLowerCase() !== lead.company.toLowerCase())
    .slice(0, 3);

  const saved = [];
  for (const business of candidates) {
    const website = normalizeWebsiteRoot(business.website);
    const competitor = await prisma.competitor.upsert({
      where: { leadId_website: { leadId, website } },
      update: { company: business.company, website },
      create: { leadId, company: business.company, website }
    });
    saved.push(competitor);
  }

  return listCompetitors(leadId);
}

export async function auditCompetitors(leadId) {
  const lead = await getLead(leadId);
  let competitors = lead.competitors;
  if (!competitors.length) {
    const found = await findCompetitors(leadId);
    competitors = found.competitors;
  }

  const browser = await createBrowser();
  try {
    for (const competitor of competitors.slice(0, 3)) {
      const business = {
        company: competitor.company,
        website: competitor.website,
        industry: lead.industry,
        location: lead.location || lead.address
      };
      const capture = await scanWebsite(browser, business, `competitor-${leadId}`, "FULL");
      const audit = await auditCompetitorWithOpenAI(lead, business, capture).catch(() => fallbackAudit(capture));
      await prisma.competitor.update({
        where: { id: competitor.id },
        data: {
          website: capture.website || competitor.website,
          screenshotPath: capture.screenshotPath,
          score: audit.score,
          strengths: audit.strengths,
          weaknesses: audit.weaknesses
        }
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return listCompetitors(leadId);
}
