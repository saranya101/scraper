import fs from "node:fs/promises";
import OpenAI from "openai";
import pLimit from "p-limit";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { normalizeWebsite, priorityFromAudit } from "../utils/priority.js";
import { enqueue } from "./queueService.js";
import { searchGooglePlaces } from "./placesService.js";
import { absoluteUploadPath, createBrowser, scanWebsite } from "./websiteScannerService.js";
import * as serviceOpportunityService from "./serviceOpportunityService.js";
const defaultAudit = {
  score: 7,
  visualDesignScore: 7,
  mobileScore: 7,
  trustScore: 7,
  ctaScore: 7,
  seoScore: 7,
  opportunityScore: 5,
  estimatedProjectValue: "",
  priority: "COLD",
  issues: ["AI audit did not complete for this website."],
  recommendedFixes: ["Review the screenshots and website manually, then rerun the scan later."],
  outreachEmail: ""
};

function domainKey(website) {
  if (!website) return "";
  try {
    return new URL(normalizeWebsite(website)).hostname.replace(/^www\./, "");
  } catch {
    return normalizeWebsite(website);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function addLog(jobId, message, progress) {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId }, select: { logs: true } });
  const logs = Array.isArray(job?.logs) ? job.logs : [];
  logs.push({ at: new Date().toISOString(), message });
  await prisma.scanJob.update({
    where: { id: jobId },
    data: {
      logs,
      ...(progress == null ? {} : { progress })
    }
  });
}

async function auditWithOpenAI({ business, capture }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new HttpError(400, "OPENAI_API_KEY is required to audit websites");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageContent = [];
  for (const imagePath of [capture.screenshotPath, capture.mobileScreenshotPath].filter(Boolean)) {
    const absolute = absoluteUploadPath(imagePath);
    const buffer = await fs.readFile(absolute).catch(() => null);
    if (buffer) {
      imageContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}`, detail: "low" }
      });
    }
  }

  const industryRules = await serviceOpportunityService.industryRuleSummary(business).catch(() => "Use balanced scoring across core website quality factors.");
  const prompt = `Audit this business website for a web agency redesign lead.
Business: ${business.company}
Industry: ${business.industry}
Location: ${business.location}
Website status: ${capture.websiteStatus}
${industryRules}
Visible text:
${capture.visibleText || "No visible text captured."}

Return strict JSON with keys:
overallScore, visualDesignScore, mobileScore, trustScore, ctaScore, seoScore, opportunityScore,
estimatedProjectValue, issues, recommendedFixes, outreachEmail.
Scores are integers 1-10 where 1 is poor website quality and 10 is excellent. opportunityScore is 1-10 where 10 is strongest sales opportunity.`;

  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a senior website conversion auditor. Return only valid JSON." },
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContent]
          }
        ],
        temperature: 0.2
      });
      break;
    } catch (error) {
      const isRateLimit = error.status === 429 || /rate limit/i.test(error.message || "");
      if (!isRateLimit || attempt === 2) throw error;
      const retryMs = Number(error.headers?.["retry-after-ms"] || 0);
      const retrySeconds = Number(error.headers?.["retry-after"] || 0) * 1000;
      await sleep(retryMs || retrySeconds || 1800 * (attempt + 1));
    }
  }

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  const score = Number(parsed.overallScore || 7);
  const opportunityScore = Number(parsed.opportunityScore || 5);
  return {
    score,
    visualDesignScore: Number(parsed.visualDesignScore || score),
    mobileScore: Number(parsed.mobileScore || score),
    trustScore: Number(parsed.trustScore || score),
    ctaScore: Number(parsed.ctaScore || score),
    seoScore: Number(parsed.seoScore || score),
    opportunityScore,
    estimatedProjectValue: String(parsed.estimatedProjectValue || ""),
    priority: priorityFromAudit(score, opportunityScore),
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    recommendedFixes: Array.isArray(parsed.recommendedFixes) ? parsed.recommendedFixes : [],
    outreachEmail: String(parsed.outreachEmail || "")
  };
}

function passesFilters(result, filters = {}) {
  if (filters.includeKeywords) {
    const haystack = `${result.company} ${result.website || ""} ${result.address || ""}`.toLowerCase();
    const required = String(filters.includeKeywords).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (required.length && !required.some((keyword) => haystack.includes(keyword))) return false;
  }
  if (filters.excludeKeywords) {
    const haystack = `${result.company} ${result.website || ""} ${result.address || ""}`.toLowerCase();
    const blocked = String(filters.excludeKeywords).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (blocked.some((keyword) => haystack.includes(keyword))) return false;
  }
  if (filters.minimumScore && result.score < Number(filters.minimumScore)) return false;
  if (filters.priority && result.priority !== filters.priority) return false;
  if (filters.websiteStatus && result.websiteStatus !== filters.websiteStatus) return false;
  return true;
}

async function createLeadFromScanResultData(resultData) {
  const website = normalizeWebsite(resultData.website);
  if (!website) return { imported: false, duplicate: false };

  const domain = domainKey(website);
  const possible = await prisma.lead.findMany({ select: { id: true, website: true } });
  const existing = possible.find((lead) => domainKey(lead.website) === domain);
  if (existing) {
    await serviceOpportunityService.generateForLead(existing.id);
    return { imported: false, duplicate: true };
  }

  const lead = await prisma.lead.create({
    data: {
      company: resultData.company,
      website,
      phone: resultData.phone,
      address: resultData.address,
      industry: resultData.industry,
      location: resultData.location,
      screenshotPath: resultData.screenshotPath,
      mobileScreenshotPath: resultData.mobileScreenshotPath,
      score: resultData.score,
      visualDesignScore: resultData.visualDesignScore,
      mobileScore: resultData.mobileScore,
      trustScore: resultData.trustScore,
      ctaScore: resultData.ctaScore,
      seoScore: resultData.seoScore,
      opportunityScore: resultData.opportunityScore,
      estimatedProjectValue: resultData.estimatedProjectValue,
      priority: resultData.priority,
      outreachEmail: resultData.outreachEmail,
      websiteStatus: resultData.websiteStatus,
      statusCode: resultData.statusCode,
      accessIssue: resultData.accessIssue,
      accessIssueReason: resultData.accessIssueReason,
      lastCheckedAt: resultData.lastCheckedAt,
      recommendedFixes: resultData.recommendedFixes,
      issues: { create: (Array.isArray(resultData.issues) ? resultData.issues : []).map((issueText) => ({ issueText: String(issueText) })) }
    }
  });

  const screenshots = [
    resultData.screenshotPath ? { leadId: lead.id, imagePath: resultData.screenshotPath, type: "DESKTOP" } : null,
    resultData.mobileScreenshotPath ? { leadId: lead.id, imagePath: resultData.mobileScreenshotPath, type: "MOBILE" } : null
  ].filter(Boolean);
  if (screenshots.length) await prisma.screenshot.createMany({ data: screenshots });
  await serviceOpportunityService.generateForLead(lead.id);

  return { imported: true, duplicate: false };
}

function resultDataFromScan({ job, business, capture, audit, duplicate }) {
  return {
    scanJobId: job.id,
    company: business.company,
    website: capture.website || normalizeWebsite(business.website),
    phone: business.phone,
    address: business.address,
    industry: business.industry,
    location: business.location,
    ...audit,
    websiteStatus: capture.websiteStatus,
    statusCode: capture.statusCode,
    accessIssue: capture.accessIssue,
    accessIssueReason: capture.accessIssueReason,
    lastCheckedAt: new Date(),
    loadTime: capture.loadTime,
    sslValid: capture.sslValid,
    redirectCount: capture.redirectCount,
    extractedHeadings: capture.extracted?.headings || [],
    extractedCTAs: capture.extracted?.ctas || [],
    extractedForms: capture.extracted?.forms || [],
    extractedSocialLinks: capture.extracted?.socialLinks || [],
    extractedEmails: capture.extracted?.emails || [],
    extractedPhones: capture.extracted?.phones || [],
    contactPageUrl: capture.extracted?.contactPageUrl || null,
    rawExtractedData: capture.extracted || {},
    screenshotPath: capture.screenshotPath,
    mobileScreenshotPath: capture.mobileScreenshotPath,
    duplicate
  };
}

async function saveResultAndLead(resultData, existingWebsites) {
  const saved = await prisma.scanResult.create({ data: resultData });
  const screenshots = [
    resultData.screenshotPath ? { scanResultId: saved.id, imagePath: resultData.screenshotPath, type: "DESKTOP" } : null,
    resultData.mobileScreenshotPath ? { scanResultId: saved.id, imagePath: resultData.mobileScreenshotPath, type: "MOBILE" } : null
  ].filter(Boolean);
  if (screenshots.length) await prisma.screenshot.createMany({ data: screenshots });
  const leadImport = await createLeadFromScanResultData(resultData);
  await prisma.scanResult.update({
    where: { id: saved.id },
    data: { imported: leadImport.imported, duplicate: leadImport.duplicate || resultData.duplicate }
  });
  if (leadImport.imported && resultData.website) existingWebsites?.add(domainKey(resultData.website));
  return saved;
}

async function processScan(job, input) {
  try {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", startedAt: new Date(), progress: 1 }
    });
    await addLog(job.id, "Searching Google Places API New.", 5);
    const businesses = await searchGooglePlaces(input);
    await addLog(job.id, `Found ${businesses.length} businesses. Starting website audits.`, 12);
    const browser = await createBrowser();
    try {
      const existing = await prisma.lead.findMany({ select: { website: true } });
      const existingWebsites = new Set(existing.map((lead) => domainKey(lead.website)));
      const limit = pLimit(Number(process.env.SCANNER_CONCURRENCY || 1));
      let complete = 0;

      await Promise.all(
        businesses.map((business) =>
          limit(async () => {
            await addLog(job.id, `Checking ${business.company}.`);
            try {
              const website = normalizeWebsite(business.website);
              const businessDomain = domainKey(website);
              if (businessDomain && existingWebsites.has(businessDomain)) {
                await addLog(job.id, `Skipped duplicate domain for ${business.company}.`);
                complete += 1;
                return;
              }

              const capture = await scanWebsite(browser, business, job.id, input.scanDepth || job.scanDepth || "QUICK");
              const audit = capture.websiteStatus === "NO_WEBSITE"
                ? {
                    score: 9,
                    visualDesignScore: 9,
                    mobileScore: 9,
                    trustScore: 8,
                    ctaScore: 9,
                    seoScore: 8,
                    opportunityScore: 4,
                    estimatedProjectValue: "",
                    priority: "COLD",
                    issues: ["No website was found in Google Places."],
                    recommendedFixes: ["Confirm whether the business has an active website before outreach."],
                    outreachEmail: ""
                  }
                : await auditWithOpenAI({ business, capture }).catch(async (error) => {
                    await addLog(job.id, `AI audit failed for ${business.company}: ${error.message}`);
                    return {
                      ...defaultAudit,
                      issues: [`AI audit failed: ${error.message}`],
                      recommendedFixes: ["Use the captured screenshots for manual review, or rerun after the OpenAI rate limit resets."]
                    };
                  });

              const resultWebsite = capture.website || website;
              const duplicate = businessDomain ? existingWebsites.has(businessDomain) : false;
              const resultData = resultDataFromScan({ job, business, capture: { ...capture, website: resultWebsite }, audit, duplicate });

              if (passesFilters(resultData, input.filters)) {
                await saveResultAndLead(resultData, existingWebsites);
              }
            } catch (error) {
              await addLog(job.id, `Failed ${business.company}: ${error.message}`);
            }

            complete += 1;
            await addLog(job.id, `Finished ${business.company}.`, Math.min(95, 12 + Math.round((complete / Math.max(businesses.length, 1)) * 83)));
          })
        )
      );
    } finally {
      await browser.close().catch(() => {});
    }
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", progress: 100, completedAt: new Date() }
    });
    await addLog(job.id, "Scan completed.", 100);
  } catch (error) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "FAILED", failedAt: new Date(), completedAt: new Date() }
    });
    await addLog(job.id, `Scan failed: ${error.message}`);
  }
}

export async function runScan(input, userId) {
  const location = [input.city, input.state, input.country].filter(Boolean).join(", ") || input.location;
  const job = await prisma.scanJob.create({
    data: {
      keyword: input.keyword,
      location,
      maxResults: Number(input.maxResults || 10),
      createdBy: userId,
      status: "QUEUED",
      progress: 0,
      scanDepth: input.scanDepth || "QUICK",
      country: input.country || null,
      state: input.state || null,
      city: input.city || null,
      minReviews: input.minReviews == null ? null : Number(input.minReviews),
      hasWebsiteOnly: Boolean(input.hasWebsiteOnly),
      logs: [{ at: new Date().toISOString(), message: "Scan queued." }]
    }
  });

  enqueue("scanner", () => processScan(job, { ...input, location }));
  return getScanJob(job.id);
}

export async function getHistory() {
  return prisma.scanJob.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { results: true } } },
    take: 30
  });
}

export async function getScanJob(id) {
  const job = await prisma.scanJob.findUnique({
    where: { id },
    include: { _count: { select: { results: true } } }
  });
  if (!job) throw notFound("Scan job not found");
  return job;
}

export async function getResults(scanJobId, query = {}) {
  await getScanJob(scanJobId);
  const where = {
    scanJobId,
    ...(query.failed === "true" ? { OR: [{ accessIssue: { not: null } }, { websiteStatus: { not: "WORKING" } }] } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.websiteStatus ? { websiteStatus: query.websiteStatus } : {}),
    ...(query.accessIssue ? { accessIssue: { contains: query.accessIssue, mode: "insensitive" } } : {}),
    ...(query.imported ? { imported: query.imported === "true" } : {}),
    ...(query.duplicate ? { duplicate: query.duplicate === "true" } : {}),
    ...(query.hasWebsite === "true" ? { website: { not: null } } : {}),
    ...(query.hasPhone === "true" ? { phone: { not: null } } : {}),
    ...(query.hasScreenshot === "true" ? { screenshotPath: { not: null } } : {}),
    ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
    ...(query.industry ? { industry: { contains: query.industry, mode: "insensitive" } } : {})
  };
  return prisma.scanResult.findMany({ where, orderBy: { createdAt: "desc" } });
}

export async function importResults(scanResultIds, userId) {
  const results = await prisma.scanResult.findMany({ where: { id: { in: scanResultIds } } });
  let imported = 0;
  let skipped = 0;

  for (const result of results) {
    const website = normalizeWebsite(result.website);
    if (!website) {
      skipped += 1;
      continue;
    }

    const exists = await prisma.lead.findUnique({ where: { website } });
    if (exists) {
      await prisma.scanResult.update({ where: { id: result.id }, data: { duplicate: true } });
      skipped += 1;
      continue;
    }

    const lead = await prisma.lead.create({
      data: {
        company: result.company,
        website,
        phone: result.phone,
        address: result.address,
        industry: result.industry,
        location: result.location,
        screenshotPath: result.screenshotPath,
        mobileScreenshotPath: result.mobileScreenshotPath,
        score: result.score,
        visualDesignScore: result.visualDesignScore,
        mobileScore: result.mobileScore,
        trustScore: result.trustScore,
        ctaScore: result.ctaScore,
        seoScore: result.seoScore,
        opportunityScore: result.opportunityScore,
        estimatedProjectValue: result.estimatedProjectValue,
        priority: result.priority,
        outreachEmail: result.outreachEmail,
        websiteStatus: result.websiteStatus,
        statusCode: result.statusCode,
        accessIssue: result.accessIssue,
        accessIssueReason: result.accessIssueReason,
        lastCheckedAt: result.lastCheckedAt,
        recommendedFixes: result.recommendedFixes,
        issues: { create: (Array.isArray(result.issues) ? result.issues : []).map((issueText) => ({ issueText: String(issueText) })) }
      }
    });

    const screenshots = [
      result.screenshotPath ? { leadId: lead.id, imagePath: result.screenshotPath, type: "DESKTOP" } : null,
      result.mobileScreenshotPath ? { leadId: lead.id, imagePath: result.mobileScreenshotPath, type: "MOBILE" } : null
    ].filter(Boolean);
    if (screenshots.length) await prisma.screenshot.createMany({ data: screenshots });
    await serviceOpportunityService.generateForLead(lead.id);
    await prisma.scanResult.update({ where: { id: result.id }, data: { imported: true } });
    imported += 1;
  }

  return { imported, skipped };
}

export async function listTemplates(userId) {
  return prisma.scanTemplate.findMany({ where: { createdBy: userId }, orderBy: { createdAt: "desc" } });
}

export async function createTemplate(input, userId) {
  return prisma.scanTemplate.create({
    data: {
      name: input.name,
      keyword: input.keyword,
      location: input.location || [input.city, input.state, input.country].filter(Boolean).join(", "),
      maxResults: Number(input.maxResults || 10),
      filters: input.filters || {},
      createdBy: userId
    }
  });
}

export async function rerun(scanJobId, userId) {
  const job = await getScanJob(scanJobId);
  return runScan(
    {
      keyword: job.keyword,
      location: job.location,
      country: job.country,
      state: job.state,
      city: job.city,
      maxResults: job.maxResults,
      scanDepth: job.scanDepth,
      minReviews: job.minReviews,
      hasWebsiteOnly: job.hasWebsiteOnly,
      filters: {}
    },
    userId
  );
}

export async function retryFailedResult(scanResultId, userId) {
  const result = await prisma.scanResult.findUnique({
    where: { id: scanResultId },
    include: { scanJob: true }
  });
  if (!result) throw notFound("Scan result not found");

  await prisma.scanJob.update({
    where: { id: result.scanJobId },
    data: {
      retryCount: { increment: 1 },
      logs: [
        ...((Array.isArray(result.scanJob.logs) ? result.scanJob.logs : [])),
        { at: new Date().toISOString(), message: `Retry queued for ${result.company}.` }
      ]
    }
  });

  enqueue("scanner", async () => {
    const job = await getScanJob(result.scanJobId);
    const business = {
      company: result.company,
      website: result.website,
      phone: result.phone,
      address: result.address,
      industry: result.industry || job.keyword,
      location: result.location || job.location
    };
    const browser = await createBrowser();
    try {
      await addLog(job.id, `Retrying ${business.company}.`);
      const capture = await scanWebsite(browser, business, job.id, job.scanDepth || "QUICK");
      const audit = capture.websiteStatus === "NO_WEBSITE"
        ? {
            ...defaultAudit,
            score: 9,
            opportunityScore: 4,
            priority: "COLD",
            issues: ["No website was found for retry."]
          }
        : await auditWithOpenAI({ business, capture }).catch(async (error) => {
            await addLog(job.id, `AI retry failed for ${business.company}: ${error.message}`);
            return {
              ...defaultAudit,
              issues: [`AI retry failed: ${error.message}`]
            };
          });
      const resultData = resultDataFromScan({
        job,
        business,
        capture,
        audit,
        duplicate: result.duplicate
      });
      await prisma.scanResult.update({
        where: { id: scanResultId },
        data: {
          ...resultData,
          imported: false
        }
      });
      const leadImport = await createLeadFromScanResultData(resultData);
      await prisma.scanResult.update({
        where: { id: scanResultId },
        data: { imported: leadImport.imported, duplicate: leadImport.duplicate || result.duplicate }
      });
      await addLog(job.id, `Retry finished for ${business.company}.`);
    } catch (error) {
      await addLog(result.scanJobId, `Retry failed for ${business.company}: ${error.message}`);
    } finally {
      await browser.close().catch(() => {});
    }
  });

  return { message: "Retry queued", scanResultId, queuedBy: userId };
}
