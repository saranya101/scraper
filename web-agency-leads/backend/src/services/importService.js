import fs from "node:fs/promises";
import crypto from "node:crypto";
import XLSX from "xlsx";
import { prisma } from "../repositories/prisma.js";
import { notFound } from "../utils/httpError.js";
import { normalizeWebsite, priorityFromAudit } from "../utils/priority.js";
import { resolveIndustryId } from "./leadService.js";
import * as serviceOpportunityService from "./serviceOpportunityService.js";

const sessions = new Map();

const fields = ["company", "website", "phone", "address", "industry", "location", "score", "visualDesignScore", "mobileScore", "trustScore", "ctaScore", "seoScore", "opportunityScore", "screenshotPath", "mobileScreenshotPath", "outreachEmail", "issues", "recommendedFixes", "websiteStatus", "estimatedProjectValue"];

const columnAliases = {
  company: ["company", "business", "name", "company name", "business name"],
  website: ["website", "url", "site", "domain", "business url", "business website"],
  phone: ["phone", "telephone", "contact number"],
  address: ["address", "location"],
  industry: ["industry", "industry query", "category", "niche", "industry type"],
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

function rowsFromFile(file) {
  const workbook = XLSX.readFile(file.path, { raw: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
}

function defaultMapping(headers) {
  const mapping = {};
  for (const field of fields) {
    const aliases = columnAliases[field] || [];
    const match = headers.find((header) => aliases.includes(normalizeHeader(header)));
    if (match) mapping[field] = match;
  }
  return mapping;
}

function value(row, mapping, field) {
  const column = mapping[field];
  return column ? row[column] : "";
}

function parseIssues(input) {
  if (!input) return [];
  return String(input).split(/\n|;|\|/g).map((item) => item.trim()).filter(Boolean);
}

function parseWebsiteStatus(input) {
  const status = String(input || "UNKNOWN").trim().toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
  return new Set(["WORKING", "CLOUDFLARE", "CAPTCHA", "FORBIDDEN", "NOT_FOUND", "SERVER_ERROR", "SSL_ERROR", "TIMEOUT", "REDIRECT_LOOP", "DOMAIN_PARKED", "WEBSITE_OFFLINE", "NO_WEBSITE", "BOT_PROTECTION", "UNKNOWN"]).has(status) ? status : "UNKNOWN";
}

function mappedRow(row, mapping) {
  const website = normalizeWebsite(value(row, mapping, "website"));
  const company = String(value(row, mapping, "company") || "").trim();
  const score = Number(value(row, mapping, "score") || 7);
  const opportunityScore = value(row, mapping, "opportunityScore") ? Number(value(row, mapping, "opportunityScore")) : null;
  const industry = String(value(row, mapping, "industry") || "").trim() || null;
  return {
    company,
    website,
    phone: String(value(row, mapping, "phone") || "").trim() || null,
    address: String(value(row, mapping, "address") || "").trim() || null,
    industry,
    location: String(value(row, mapping, "location") || value(row, mapping, "address") || "").trim() || null,
    score,
    visualDesignScore: value(row, mapping, "visualDesignScore") ? Number(value(row, mapping, "visualDesignScore")) : null,
    mobileScore: value(row, mapping, "mobileScore") ? Number(value(row, mapping, "mobileScore")) : null,
    trustScore: value(row, mapping, "trustScore") ? Number(value(row, mapping, "trustScore")) : null,
    ctaScore: value(row, mapping, "ctaScore") ? Number(value(row, mapping, "ctaScore")) : null,
    seoScore: value(row, mapping, "seoScore") ? Number(value(row, mapping, "seoScore")) : null,
    opportunityScore,
    estimatedProjectValue: String(value(row, mapping, "estimatedProjectValue") || "").trim() || null,
    priority: priorityFromAudit(score, opportunityScore),
    screenshotPath: String(value(row, mapping, "screenshotPath") || "").trim() || null,
    mobileScreenshotPath: String(value(row, mapping, "mobileScreenshotPath") || "").trim() || null,
    outreachEmail: String(value(row, mapping, "outreachEmail") || "").trim() || null,
    websiteStatus: parseWebsiteStatus(value(row, mapping, "websiteStatus")),
    recommendedFixes: parseIssues(value(row, mapping, "recommendedFixes")),
    issues: parseIssues(value(row, mapping, "issues"))
  };
}

async function analyze(rows, mapping) {
  const existing = await prisma.lead.findMany({ select: { website: true } });
  const existingSites = new Set(existing.map((lead) => normalizeWebsite(lead.website)));
  const seen = new Set();
  const preview = rows.map((row, index) => {
    const mapped = mappedRow(row, mapping);
    const missingWebsite = !mapped.website;
    const duplicate = mapped.website && (existingSites.has(mapped.website) || seen.has(mapped.website));
    if (mapped.website) seen.add(mapped.website);
    const valid = Boolean(mapped.company && mapped.website);
    return { index, ...mapped, valid, duplicate: Boolean(duplicate), missingWebsite };
  });
  return {
    rowsFound: rows.length,
    validRows: preview.filter((row) => row.valid).length,
    duplicates: preview.filter((row) => row.duplicate).length,
    missingWebsite: preview.filter((row) => row.missingWebsite).length,
    readyToImport: preview.filter((row) => row.valid && !row.duplicate && !row.missingWebsite).length,
    preview: preview.slice(0, 25)
  };
}

export async function previewImport(file, userId) {
  const rows = rowsFromFile(file);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const mapping = defaultMapping(headers);
  const analysis = await analyze(rows, mapping);
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    id: sessionId,
    fileName: file.originalname,
    userId,
    rows,
    headers,
    mapping,
    createdAt: Date.now(),
    cancelled: false
  });
  await fs.unlink(file.path).catch(() => {});
  return { sessionId, fileName: file.originalname, headers, fields, mapping, ...analysis };
}

export async function updatePreview(sessionId, mapping) {
  const session = sessions.get(sessionId);
  if (!session || session.cancelled) throw notFound("Import preview not found");
  session.mapping = { ...session.mapping, ...mapping };
  return { sessionId, fileName: session.fileName, headers: session.headers, fields, mapping: session.mapping, ...(await analyze(session.rows, session.mapping)) };
}

async function applyDuplicate(existing, data, mode) {
  if (mode === "skip") return { imported: false, duplicate: true, failed: false };
  if (mode === "update") {
    await prisma.lead.update({ where: { id: existing.id }, data });
    await serviceOpportunityService.generateForLead(existing.id);
    return { imported: true, duplicate: true, failed: false };
  }
  const merged = Object.fromEntries(
    Object.entries(data).filter(([key, item]) => {
      if (key === "website") return false;
      const hasIncoming = item != null && item !== "" && !(Array.isArray(item) && !item.length);
      const current = existing[key];
      const isMissing = current == null || current === "" || (Array.isArray(current) && !current.length);
      return hasIncoming && isMissing;
    })
  );
  if (Object.keys(merged).length) {
    await prisma.lead.update({ where: { id: existing.id }, data: merged });
    await serviceOpportunityService.generateForLead(existing.id);
  }
  return { imported: true, duplicate: true, failed: false };
}

async function createOrUpdateLead(mapped, duplicateMode) {
  if (!mapped.company || !mapped.website) return { imported: false, duplicate: false, failed: true };
  const existing = await prisma.lead.findUnique({ where: { website: mapped.website } });
  const data = {
    company: mapped.company,
    website: mapped.website,
    phone: mapped.phone,
    address: mapped.address,
    industry: mapped.industry,
    industryId: await resolveIndustryId({ industry: mapped.industry, company: mapped.company }),
    location: mapped.location,
    score: mapped.score,
    visualDesignScore: mapped.visualDesignScore,
    mobileScore: mapped.mobileScore,
    trustScore: mapped.trustScore,
    ctaScore: mapped.ctaScore,
    seoScore: mapped.seoScore,
    opportunityScore: mapped.opportunityScore,
    estimatedProjectValue: mapped.estimatedProjectValue,
    priority: mapped.priority,
    screenshotPath: mapped.screenshotPath,
    mobileScreenshotPath: mapped.mobileScreenshotPath,
    outreachEmail: mapped.outreachEmail,
    websiteStatus: mapped.websiteStatus,
    recommendedFixes: mapped.recommendedFixes
  };
  if (existing) return applyDuplicate(existing, data, duplicateMode);
  const lead = await prisma.lead.create({
    data: {
      ...data,
      issues: { create: mapped.issues.map((issueText) => ({ issueText })) }
    }
  });
  await serviceOpportunityService.generateForLead(lead.id);
  return { imported: true, duplicate: false, failed: false };
}

export async function commitImport(sessionId, userId, input = {}) {
  const session = sessions.get(sessionId);
  if (!session || session.cancelled || session.userId !== userId) throw notFound("Import preview not found");
  const duplicateMode = ["skip", "update", "merge"].includes(input.duplicateMode) ? input.duplicateMode : "skip";
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  let processed = 0;
  let cancelled = false;
  for (const row of session.rows) {
    if (session.cancelled) {
      cancelled = true;
      failed += session.rows.length - processed;
      break;
    }
    const mapped = mappedRow(row, session.mapping);
    const result = await createOrUpdateLead(mapped, duplicateMode).catch(() => ({ imported: false, duplicate: false, failed: true }));
    processed += 1;
    if (result.imported) imported += 1;
    if (result.duplicate) duplicates += 1;
    if (result.failed) failed += 1;
  }
  const record = await prisma.import.create({
    data: {
      fileName: session.fileName,
      importedBy: userId,
      totalRows: session.rows.length,
      importedRows: imported,
      duplicateRows: duplicates,
      failedRows: failed
    },
    include: { user: { select: { name: true, email: true } } }
  });
  sessions.delete(sessionId);
  return { import: record, imported, duplicates, failed, totalRows: record.totalRows, cancelled };
}

export async function cancelImport(sessionId, userId) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) throw notFound("Import preview not found");
  session.cancelled = true;
  sessions.delete(sessionId);
  return { cancelled: true };
}

export async function listHistory(userId) {
  return prisma.import.findMany({
    where: { importedBy: userId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
}

export async function importLeads(file, userId) {
  const preview = await previewImport(file, userId);
  return commitImport(preview.sessionId, userId, { duplicateMode: "skip" });
}
