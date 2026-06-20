import fs from "node:fs/promises";
import OpenAI from "openai";
import pLimit from "p-limit";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { normalizeWebsiteRoot, priorityFromAudit, websiteDomainKey } from "../utils/priority.js";
import { resolveIndustryId } from "./leadService.js";
import { enqueue } from "./queueService.js";
import { searchGooglePlaces } from "./placesService.js";
import { absoluteUploadPath, createBrowser, scanWebsite } from "./websiteScannerService.js";
import { auditCriteriaFor, getIndustryProfile, getIndustryProfileConfig } from "./industryProfileService.js";
import * as serviceOpportunityService from "./serviceOpportunityService.js";
const defaultAudit = {
  score: 7,
  visualDesignScore: 7,
  mobileScore: 7,
  trustScore: 7,
  ctaScore: 7,
  seoScore: 7,
  conversionScore: 7,
  speedScore: 7,
  bookingScore: 7,
  analyticsScore: 7,
  contactabilityScore: 7,
  opportunityScore: 5,
  estimatedProjectValue: "",
  priority: "COLD",
  issues: ["AI audit did not complete for this website."],
  recommendedFixes: ["Review the screenshots and website manually, then rerun the scan later."],
  outreachEmail: ""
};

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

async function updateProgress(jobId, data = {}) {
  const progressData = {};
  if (data.progressPercent != null) progressData.progress = data.progressPercent;
  if (Object.keys(progressData).length) {
    await prisma.scanJob.update({ where: { id: jobId }, data: progressData });
  }

  const updates = [];
  const values = [];
  const add = (column, value) => {
    updates.push(`"${column}" = $${values.length + 1}`);
    values.push(value);
  };
  if (data.currentStage) add("currentStage", data.currentStage);
  if (data.progressPercent != null) add("progressPercent", data.progressPercent);
  if (data.totalItems != null) add("totalItems", data.totalItems);
  if (data.completedItems != null) add("completedItems", data.completedItems);
  if (data.failedItems != null) add("failedItems", data.failedItems);
  if (Object.prototype.hasOwnProperty.call(data, "currentUrl")) add("currentUrl", data.currentUrl);
  if (!updates.length) return;
  values.push(jobId);
  await prisma.$executeRawUnsafe(`UPDATE "scan_jobs" SET ${updates.join(", ")} WHERE "id" = $${values.length}`, ...values).catch(() => {});
}

function progressPercent(completed, total, min = 10, max = 95) {
  return Math.min(max, min + Math.round((completed / Math.max(total, 1)) * (max - min)));
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
  const industryCriteria = (await getIndustryProfileConfig(business.industrySlug).catch(() => null))?.auditCriteria || auditCriteriaFor(business);
  const prompt = `Audit this business website for a web agency redesign lead.
Business: ${business.company}
Industry: ${business.industry}
Location: ${business.location}
Website status: ${capture.websiteStatus}
${industryRules}
Industry-specific criteria:
${industryCriteria}
Visible text:
${capture.visibleText || "No visible text captured."}

Return strict JSON with keys:
overallScore, visualDesignScore, mobileScore, trustScore, ctaScore, seoScore, conversionScore, speedScore, bookingScore, analyticsScore, contactabilityScore, opportunityScore,
estimatedProjectValue, issues, recommendedFixes, outreachEmail.
recommendedFixes must be an array of objects with: title, priority, impact, effort, serviceFit, details.
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
    conversionScore: Number(parsed.conversionScore || parsed.opportunityScore || score),
    speedScore: Number(parsed.speedScore || score),
    bookingScore: Number(parsed.bookingScore || score),
    analyticsScore: Number(parsed.analyticsScore || score),
    contactabilityScore: Number(parsed.contactabilityScore || score),
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

function parseEstimatedValue(value) {
  const numbers = String(value || "").match(/\d[\d,]*/g)?.map((item) => Number(item.replaceAll(",", ""))) || [];
  if (!numbers.length) return 0;
  return Math.max(...numbers);
}

export function scanSummary(results = []) {
  const businessesFound = results.length;
  const websitesAudited = results.filter((result) => result.websiteStatus && result.websiteStatus !== "NO_WEBSITE").length;
  const qualifiedLeads = results.filter((result) => !result.duplicate && result.priority !== "COLD" && result.websiteStatus === "WORKING").length;
  const importedLeads = results.filter((result) => result.imported).length;
  const avgOpportunity = businessesFound
    ? Math.round(results.reduce((sum, result) => sum + Number(result.opportunityScore || 0), 0) / businessesFound)
    : 0;
  const estimatedPipelineGenerated = results.reduce((sum, result) => sum + parseEstimatedValue(result.estimatedProjectValue), 0);
  return {
    businessesFound,
    websitesAudited,
    qualifiedLeads,
    importedLeads,
    avgOpportunity,
    estimatedPipelineGenerated
  };
}

async function createLeadFromScanResultData(resultData) {
  const website = normalizeWebsiteRoot(resultData.website);
  if (!website) return { imported: false, duplicate: false };

  const domain = websiteDomainKey(website);
  const possible = await prisma.lead.findMany({ select: { id: true, website: true } });
  const existing = possible.find((lead) => websiteDomainKey(lead.website) === domain);
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
      industryId: await resolveIndustryId({ industry: resultData.industry, company: resultData.company }),
      location: resultData.location,
      screenshotPath: resultData.screenshotPath,
      mobileScreenshotPath: resultData.mobileScreenshotPath,
      score: resultData.score,
      visualDesignScore: resultData.visualDesignScore,
      mobileScore: resultData.mobileScore,
      trustScore: resultData.trustScore,
      ctaScore: resultData.ctaScore,
      seoScore: resultData.seoScore,
      conversionScore: resultData.conversionScore,
      speedScore: resultData.speedScore,
      bookingScore: resultData.bookingScore,
      analyticsScore: resultData.analyticsScore,
      contactabilityScore: resultData.contactabilityScore,
      opportunityScore: resultData.opportunityScore,
      estimatedProjectValue: resultData.estimatedProjectValue,
      priority: resultData.priority,
      outreachEmail: resultData.outreachEmail,
      websiteStatus: resultData.websiteStatus,
      statusCode: resultData.statusCode,
      accessIssue: resultData.accessIssue,
      accessIssueReason: resultData.accessIssueReason,
      lastCheckedAt: resultData.lastCheckedAt,
      cms: resultData.cms,
      analyticsGa4: resultData.analyticsGa4,
      analyticsGtm: resultData.analyticsGtm,
      analyticsMetaPixel: resultData.analyticsMetaPixel,
      bookingCalendly: resultData.bookingCalendly,
      bookingSimplyBook: resultData.bookingSimplyBook,
      bookingAcuity: resultData.bookingAcuity,
      marketingMailchimp: resultData.marketingMailchimp,
      marketingHubspot: resultData.marketingHubspot,
      marketingKlaviyo: resultData.marketingKlaviyo,
      chatIntercom: resultData.chatIntercom,
      chatTawk: resultData.chatTawk,
      chatZendesk: resultData.chatZendesk,
      generalEmail: resultData.generalEmail,
      ownerEmail: resultData.ownerEmail,
      linkedinCompany: resultData.linkedinCompany,
      instagram: resultData.instagram,
      facebook: resultData.facebook,
      whatsapp: resultData.whatsapp,
      contactConfidence: resultData.contactConfidence,
      contactSource: resultData.contactSource,
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

function contactAndTechFields(extracted = {}) {
  const tech = extracted.techStack || {};
  const contact = extracted.contactInfo || {};
  return {
    cms: tech.cms || null,
    analyticsGa4: Boolean(tech.analyticsGa4),
    analyticsGtm: Boolean(tech.analyticsGtm),
    analyticsMetaPixel: Boolean(tech.analyticsMetaPixel),
    bookingCalendly: Boolean(tech.bookingCalendly),
    bookingSimplyBook: Boolean(tech.bookingSimplyBook),
    bookingAcuity: Boolean(tech.bookingAcuity),
    marketingMailchimp: Boolean(tech.marketingMailchimp),
    marketingHubspot: Boolean(tech.marketingHubspot),
    marketingKlaviyo: Boolean(tech.marketingKlaviyo),
    chatIntercom: Boolean(tech.chatIntercom),
    chatTawk: Boolean(tech.chatTawk),
    chatZendesk: Boolean(tech.chatZendesk),
    generalEmail: contact.generalEmail || extracted.emails?.[0] || null,
    ownerEmail: contact.ownerEmail || null,
    linkedinCompany: contact.linkedinCompany || null,
    instagram: contact.instagram || null,
    facebook: contact.facebook || null,
    whatsapp: contact.whatsapp || null,
    contactConfidence: contact.contactConfidence == null ? null : Number(contact.contactConfidence),
    contactSource: contact.contactSource || null
  };
}

function resultDataFromScan({ job, business, capture, audit, duplicate }) {
  const intelligence = contactAndTechFields(capture.extracted || {});
  return {
    scanJobId: job.id,
    company: business.company,
    website: capture.website || normalizeWebsiteRoot(business.website),
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
    ...intelligence,
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
  if (leadImport.imported && resultData.website) existingWebsites?.add(websiteDomainKey(resultData.website));
  return saved;
}

async function scanBusinessWebsite({ job, browser, business, existingWebsites, input, total, completed, failed }) {
  const website = normalizeWebsiteRoot(business.website);
  const businessDomain = websiteDomainKey(website);
  await updateProgress(job.id, {
    currentStage: "Visiting Website",
    currentUrl: website,
    totalItems: total,
    completedItems: completed,
    failedItems: failed,
    progressPercent: progressPercent(completed, total, 18, 86)
  });
  await addLog(job.id, `Visiting ${website || business.company}.`);

  if (businessDomain && existingWebsites.has(businessDomain)) {
    await addLog(job.id, `Skipped duplicate domain for ${business.company}.`);
    return { skipped: true };
  }

  await updateProgress(job.id, { currentStage: "Taking Screenshots", currentUrl: website });
  const capture = await scanWebsite(browser, business, job.id, input.scanDepth || job.scanDepth || "QUICK");
  await updateProgress(job.id, { currentStage: "Extracting Text", currentUrl: capture.website || website });
  await updateProgress(job.id, { currentStage: "Detecting Tech Stack", currentUrl: capture.website || website });
  await updateProgress(job.id, { currentStage: "Running AI Audit", currentUrl: capture.website || website });

  const audit = capture.websiteStatus === "NO_WEBSITE"
    ? {
        score: 9,
        visualDesignScore: 9,
        mobileScore: 9,
        trustScore: 8,
        ctaScore: 9,
        seoScore: 8,
        conversionScore: 8,
        speedScore: 8,
        bookingScore: 8,
        analyticsScore: 8,
        contactabilityScore: 3,
        opportunityScore: 4,
        estimatedProjectValue: "",
        priority: "COLD",
        issues: ["No website was found."],
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

  await updateProgress(job.id, { currentStage: "Saving Results", currentUrl: capture.website || website });
  const resultWebsite = capture.website || website;
  const duplicate = businessDomain ? existingWebsites.has(businessDomain) : false;
  const resultData = resultDataFromScan({ job, business, capture: { ...capture, website: resultWebsite }, audit, duplicate });

  if (passesFilters(resultData, input.filters)) {
    await updateProgress(job.id, { currentStage: "Importing Leads", currentUrl: resultWebsite });
    await saveResultAndLead(resultData, existingWebsites);
  }
  return { skipped: false };
}

async function processScan(job, input) {
  try {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", startedAt: new Date(), progress: 1 }
    });
    await updateProgress(job.id, { progressPercent: 1, currentStage: "Searching / Preparing URLs" });
    await addLog(job.id, "Searching Google Places API New.", 5);
    const businesses = await searchGooglePlaces(input);
    await updateProgress(job.id, { totalItems: businesses.length, currentStage: "Searching / Preparing URLs", progressPercent: 12 });
    await addLog(job.id, `Found ${businesses.length} businesses. Starting website audits.`, 12);
    const browser = await createBrowser();
    try {
      const existing = await prisma.lead.findMany({ select: { website: true } });
      const existingWebsites = new Set(existing.map((lead) => websiteDomainKey(lead.website)));
      const limit = pLimit(Number(process.env.SCANNER_CONCURRENCY || 1));
      let complete = 0;

      await Promise.all(
        businesses.map((business) =>
          limit(async () => {
            await addLog(job.id, `Checking ${business.company}.`);
            try {
              await scanBusinessWebsite({ job, browser, business, existingWebsites, input, total: businesses.length, completed: complete, failed: Number(job.failedItems || 0) });
            } catch (error) {
              await addLog(job.id, `Failed ${business.company}: ${error.message}`);
              await updateProgress(job.id, { failedItems: Number(job.failedItems || 0) + 1 });
            }

            complete += 1;
            await updateProgress(job.id, { completedItems: complete, progressPercent: progressPercent(complete, businesses.length), currentStage: complete >= businesses.length ? "Completed" : "Saving Results" });
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
    await updateProgress(job.id, { progressPercent: 100, currentStage: "Completed", currentUrl: null });
    await addLog(job.id, "Scan completed.", 100);
  } catch (error) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "FAILED", failedAt: new Date(), completedAt: new Date() }
    });
    await updateProgress(job.id, { currentStage: "Failed" });
    await addLog(job.id, `Scan failed: ${error.message}`);
  }
}

export async function runScan(input, userId) {
  const location = [input.city, input.state, input.country].filter(Boolean).join(", ") || input.location;
  const profile = getIndustryProfile(input.industrySlug);
  const job = await prisma.scanJob.create({
    data: {
      keyword: input.industryName || profile.name || input.keyword,
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

  enqueue("scanner", () => processScan(job, { ...input, location, industryName: input.industryName || profile.name }));
  return getScanJob(job.id);
}

function parseUrls(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/\r?\n|,/);
  return [...new Set(list.map((url) => normalizeWebsiteRoot(url.trim())).filter(Boolean))];
}

function companyFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0].replaceAll("-", " ");
  } catch {
    return url;
  }
}

async function processDirectScan(job, input) {
  const urls = parseUrls(input.urls || input.websites || input.websiteUrl);
  let complete = 0;
  let failed = 0;
  try {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        progress: 2,
        logs: [{ at: new Date().toISOString(), message: `${job.scanMode === "BULK_WEBSITE" ? "Bulk" : "Direct"} website scan queued.` }]
      }
    });
    await updateProgress(job.id, { totalItems: urls.length, progressPercent: 2, currentStage: "Searching / Preparing URLs" });
    await addLog(job.id, `Prepared ${urls.length} website URL${urls.length === 1 ? "" : "s"}.`, 8);
    const browser = await createBrowser();
    try {
      const existing = await prisma.lead.findMany({ select: { website: true } });
      const existingWebsites = new Set(existing.map((lead) => websiteDomainKey(lead.website)));
      for (const url of urls) {
        const profile = getIndustryProfile(input.industrySlug);
        const business = {
          company: input.company || companyFromUrl(url),
          website: url,
          phone: null,
          address: null,
          industry: input.industryName || profile.name,
          industrySlug: input.industrySlug,
          location: input.location || "Direct website scan"
        };
        try {
          await scanBusinessWebsite({ job, browser, business, existingWebsites, input, total: urls.length, completed: complete, failed });
        } catch (error) {
          failed += 1;
          await updateProgress(job.id, { failedItems: failed });
          await addLog(job.id, `Failed ${url}: ${error.message}`);
        }
        complete += 1;
        await updateProgress(job.id, {
          completedItems: complete,
          failedItems: failed,
          currentStage: complete >= urls.length ? "Completed" : "Saving Results",
          progressPercent: progressPercent(complete, urls.length),
          currentUrl: complete >= urls.length ? null : url
        });
      }
    } finally {
      await browser.close().catch(() => {});
    }
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", progress: 100, completedAt: new Date() }
    });
    await updateProgress(job.id, { progressPercent: 100, currentStage: "Completed", currentUrl: null });
    await addLog(job.id, "Direct website scan completed.", 100);
  } catch (error) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "FAILED", failedAt: new Date(), completedAt: new Date() }
    });
    await updateProgress(job.id, { currentStage: "Failed" });
    await addLog(job.id, `Direct scan failed: ${error.message}`);
  }
}

async function createDirectScanJob(input, userId, scanMode) {
  const urls = parseUrls(input.urls || input.websites || input.websiteUrl);
  if (!urls.length) throw new HttpError(422, "Add at least one website URL");
  const profile = getIndustryProfile(input.industrySlug);
  const job = await prisma.scanJob.create({
    data: {
      keyword: input.company || input.industryName || profile.name || "Direct website scan",
      location: input.location || "Direct website scan",
      maxResults: urls.length,
      createdBy: userId,
      status: "QUEUED",
      progress: 0,
      scanDepth: input.scanDepth || "FULL",
      hasWebsiteOnly: true,
      logs: [{ at: new Date().toISOString(), message: "Direct website scan queued." }]
    }
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "scan_jobs" SET "scanMode" = $1, "directUrls" = $2::jsonb, "progressPercent" = 0, "currentStage" = 'Queued', "totalItems" = $3, "completedItems" = 0, "failedItems" = 0, "currentUrl" = $4 WHERE "id" = $5`,
    scanMode,
    JSON.stringify(urls),
    urls.length,
    urls[0] || null,
    job.id
  ).catch(() => {});
  enqueue("scanner", () => processDirectScan(job, { ...input, urls }));
  return getScanJob(job.id);
}

export async function runDirectScan(input, userId) {
  return createDirectScanJob({ ...input, urls: [input.websiteUrl] }, userId, "SINGLE_WEBSITE");
}

export async function runBulkScan(input, userId) {
  return createDirectScanJob(input, userId, "BULK_WEBSITE");
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

export async function getScanProgress(id) {
  const job = await getScanJob(id);
  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const remaining = job.totalItems && job.completedItems && startedAt
    ? Math.max(0, Math.round(((Date.now() - startedAt) / Math.max(job.completedItems, 1)) * Math.max(job.totalItems - job.completedItems, 0) / 1000))
    : null;
  return {
    id: job.id,
    status: job.status,
    currentStage: job.currentStage || (job.status === "QUEUED" ? "Queued" : "Scanning"),
    progressPercent: job.progressPercent || job.progress || 0,
    currentUrl: job.currentUrl,
    totalItems: job.totalItems || job._count?.results || 0,
    completedItems: job.completedItems || 0,
    failedItems: job.failedItems || 0,
    estimatedSecondsRemaining: remaining,
    logs: Array.isArray(job.logs) ? job.logs : []
  };
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
  const results = await prisma.scanResult.findMany({ where, orderBy: { createdAt: "desc" } });
  const leads = await prisma.lead.findMany({ select: { id: true, website: true } });
  const leadByDomain = new Map(leads.map((lead) => [websiteDomainKey(lead.website), lead.id]));
  const items = results.map((result) => ({
    ...result,
    leadId: result.website ? leadByDomain.get(websiteDomainKey(result.website)) || null : null
  }));
  return { items, summary: scanSummary(results) };
}

export async function importResults(scanResultIds, userId) {
  const results = await prisma.scanResult.findMany({ where: { id: { in: scanResultIds } } });
  let imported = 0;
  let skipped = 0;

  for (const result of results) {
    const website = normalizeWebsiteRoot(result.website);
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
        industryId: await resolveIndustryId({ industry: result.industry, company: result.company }),
        location: result.location,
        screenshotPath: result.screenshotPath,
        mobileScreenshotPath: result.mobileScreenshotPath,
        score: result.score,
        visualDesignScore: result.visualDesignScore,
        mobileScore: result.mobileScore,
        trustScore: result.trustScore,
        ctaScore: result.ctaScore,
        seoScore: result.seoScore,
        conversionScore: result.conversionScore,
        speedScore: result.speedScore,
        bookingScore: result.bookingScore,
        analyticsScore: result.analyticsScore,
        contactabilityScore: result.contactabilityScore,
        opportunityScore: result.opportunityScore,
        estimatedProjectValue: result.estimatedProjectValue,
        priority: result.priority,
        outreachEmail: result.outreachEmail,
        websiteStatus: result.websiteStatus,
        statusCode: result.statusCode,
        accessIssue: result.accessIssue,
        accessIssueReason: result.accessIssueReason,
        lastCheckedAt: result.lastCheckedAt,
        cms: result.cms,
        analyticsGa4: result.analyticsGa4,
        analyticsGtm: result.analyticsGtm,
        analyticsMetaPixel: result.analyticsMetaPixel,
        bookingCalendly: result.bookingCalendly,
        bookingSimplyBook: result.bookingSimplyBook,
        bookingAcuity: result.bookingAcuity,
        marketingMailchimp: result.marketingMailchimp,
        marketingHubspot: result.marketingHubspot,
        marketingKlaviyo: result.marketingKlaviyo,
        chatIntercom: result.chatIntercom,
        chatTawk: result.chatTawk,
        chatZendesk: result.chatZendesk,
        generalEmail: result.generalEmail,
        ownerEmail: result.ownerEmail,
        linkedinCompany: result.linkedinCompany,
        instagram: result.instagram,
        facebook: result.facebook,
        whatsapp: result.whatsapp,
        contactConfidence: result.contactConfidence,
        contactSource: result.contactSource,
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

export async function listTemplates(userId, query = {}) {
  const templates = await prisma.scanTemplate.findMany({ where: { createdBy: userId }, orderBy: { createdAt: "desc" } });
  if (!query.industrySlug) return templates;
  return templates.filter((template) => {
    const filters = template.filters && typeof template.filters === "object" ? template.filters : {};
    return filters.industrySlug === query.industrySlug || String(template.keyword || "").toLowerCase().includes(String(query.industrySlug).replaceAll("-", " "));
  });
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
