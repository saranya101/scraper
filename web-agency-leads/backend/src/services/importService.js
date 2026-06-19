import fs from "node:fs/promises";
import XLSX from "xlsx";
import { prisma } from "../repositories/prisma.js";
import { normalizeWebsite, priorityFromAudit } from "../utils/priority.js";
import * as serviceOpportunityService from "./serviceOpportunityService.js";

const columnAliases = {
  company: ["company", "business", "name", "company name"],
  website: ["website", "url", "site", "domain"],
  phone: ["phone", "telephone", "contact number"],
  address: ["address", "location"],
  industry: ["industry", "industry query", "category", "niche"],
  location: ["location", "city", "area"],
  score: ["score", "audit score", "ai score"],
  visualDesignScore: ["visual design score", "design score"],
  mobileScore: ["mobile score"],
  trustScore: ["trust score"],
  ctaScore: ["cta score"],
  seoScore: ["seo score"],
  opportunityScore: ["opportunity score"],
  screenshotPath: ["screenshot", "screenshot path", "image"],
  mobileScreenshotPath: ["mobile screenshot", "mobile screenshot path"],
  outreachEmail: ["outreach", "outreach email", "email copy"],
  issues: ["issues", "issue", "problems", "findings"],
  recommendedFixes: ["recommended fixes", "fixes"],
  websiteStatus: ["website status", "status"],
  estimatedProjectValue: ["estimated project value", "project value"]
};

function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase();
}

function getValue(row, key) {
  const aliases = columnAliases[key];
  const found = Object.keys(row).find((column) => aliases.includes(normalizeHeader(column)));
  return found ? row[found] : undefined;
}

function rowsFromFile(file) {
  const workbook = XLSX.readFile(file.path, { raw: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
}

function parseIssues(value) {
  if (!value) return [];
  return String(value)
    .split(/\n|;|\|/g)
    .map((issue) => issue.trim())
    .filter(Boolean);
}

function parseWebsiteStatus(value) {
  const status = String(value || "UNKNOWN").trim().toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
  const allowed = new Set([
    "WORKING",
    "CLOUDFLARE",
    "CAPTCHA",
    "FORBIDDEN",
    "NOT_FOUND",
    "SERVER_ERROR",
    "SSL_ERROR",
    "TIMEOUT",
    "REDIRECT_LOOP",
    "DOMAIN_PARKED",
    "WEBSITE_OFFLINE",
    "NO_WEBSITE",
    "BOT_PROTECTION",
    "UNKNOWN"
  ]);
  return allowed.has(status) ? status : "UNKNOWN";
}

export async function importLeads(file, userId) {
  const rows = rowsFromFile(file);
  const existing = await prisma.lead.findMany({ select: { website: true } });
  const existingSites = new Set(existing.map((lead) => normalizeWebsite(lead.website)));
  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const website = normalizeWebsite(getValue(row, "website"));
    const company = String(getValue(row, "company") || "").trim();
    if (!website || !company || existingSites.has(website)) {
      skipped += 1;
      continue;
    }

    const score = Number(getValue(row, "score") || 7);
    const opportunityScore = getValue(row, "opportunityScore") ? Number(getValue(row, "opportunityScore")) : null;
    const lead = await prisma.lead.create({
      data: {
        company,
        website,
        phone: String(getValue(row, "phone") || "").trim() || null,
        address: String(getValue(row, "address") || "").trim() || null,
        industry: String(getValue(row, "industry") || "").trim() || null,
        location: String(getValue(row, "location") || getValue(row, "address") || "").trim() || null,
        score,
        visualDesignScore: getValue(row, "visualDesignScore") ? Number(getValue(row, "visualDesignScore")) : null,
        mobileScore: getValue(row, "mobileScore") ? Number(getValue(row, "mobileScore")) : null,
        trustScore: getValue(row, "trustScore") ? Number(getValue(row, "trustScore")) : null,
        ctaScore: getValue(row, "ctaScore") ? Number(getValue(row, "ctaScore")) : null,
        seoScore: getValue(row, "seoScore") ? Number(getValue(row, "seoScore")) : null,
        opportunityScore,
        estimatedProjectValue: String(getValue(row, "estimatedProjectValue") || "").trim() || null,
        priority: priorityFromAudit(score, opportunityScore),
        screenshotPath: String(getValue(row, "screenshotPath") || "").trim() || null,
        mobileScreenshotPath: String(getValue(row, "mobileScreenshotPath") || "").trim() || null,
        outreachEmail: String(getValue(row, "outreachEmail") || "").trim() || null,
        websiteStatus: parseWebsiteStatus(getValue(row, "websiteStatus")),
        recommendedFixes: parseIssues(getValue(row, "recommendedFixes")),
        issues: { create: parseIssues(getValue(row, "issues")).map((issueText) => ({ issueText })) }
      }
    });
    await serviceOpportunityService.generateForLead(lead.id);
    existingSites.add(website);
    created += 1;
  }

  const importRecord = await prisma.import.create({
    data: {
      fileName: file.originalname,
      importedBy: userId,
      totalRows: rows.length
    }
  });

  await fs.unlink(file.path).catch(() => {});
  return { import: importRecord, created, skipped, totalRows: rows.length };
}
