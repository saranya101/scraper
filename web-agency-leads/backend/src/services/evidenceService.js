import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { normalizeWebsiteRoot } from "../utils/priority.js";
import { detectTech, extractPageData, mergeExtractedData } from "./extractionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, "../../uploads");
const evidenceShotDir = path.join(uploadsDir, "evidence");
const detectorVersion = `evidence-v2-${createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 12)}`;
const transientRetryDelays = [300, 900, 1800];

const signalLabels = {
  phoneVisible: "Phone visible",
  emailVisible: "Email visible",
  whatsappLinkPresent: "WhatsApp link",
  contactFormPresent: "Contact form",
  bookingFormPresent: "Booking form",
  servicePagesPresent: "Service pages",
  projectCaseStudyPagesPresent: "Project/case study pages",
  socialLinksPresent: "Social links",
  basicSeoPresent: "Basic SEO",
  pageSpeedUsable: "PageSpeed usable",
  techStackDetected: "Tech stack",
  awardsVisible: "Awards visible",
  trustBadgesVisible: "Trust badges visible",
  certificationsVisible: "Certifications visible",
  testimonialsVisible: "Testimonials visible",
  reviewsVisible: "Reviews visible",
  ctaVisible: "CTA visible",
  portfolioProjectVisuals: "Portfolio/project visuals",
  beforeAfterVisuals: "Before/after visuals",
  firstCtaScrollDepth: "First CTA scroll depth",
  awardsBadgesScrollDepth: "Awards/badges scroll depth"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getDetectorVersion() {
  return detectorVersion;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function createScanInputHash(input = {}) {
  const fingerprint = {
    website: normalizeWebsiteRoot(input.website || input.canonical || ""),
    statusCode: input.statusCode || null,
    loadTime: input.loadTime || null,
    title: input.title || input.rawExtractedData?.title || "",
    metaDescription: input.metaDescription || input.rawExtractedData?.metaDescription || "",
    headings: input.headings || input.rawExtractedData?.headings || [],
    ctas: input.ctas || input.rawExtractedData?.ctas || [],
    forms: input.forms || input.rawExtractedData?.forms || [],
    socialLinks: input.socialLinks || input.rawExtractedData?.socialLinks || [],
    emails: input.emails || input.rawExtractedData?.emails || [],
    phones: input.phones || input.rawExtractedData?.phones || [],
    links: input.links || input.rawExtractedData?.links || [],
    techStack: input.techStack || input.rawExtractedData?.techStack || null,
    contactPageUrl: input.contactPageUrl || input.rawExtractedData?.contactPageUrl || null
  };
  return createHash("sha256").update(stableJson(fingerprint)).digest("hex");
}

export function isFreshCheapEvidence(scanEvidence, scanInputHash, version = detectorVersion) {
  return Boolean(
    scanEvidence &&
    scanEvidence.mode === "cheap" &&
    scanEvidence.status === "evidence_complete" &&
    scanEvidence.scanInputHash === scanInputHash &&
    scanEvidence.detectorVersion === version
  );
}

export function pendingCheapEvidence({ leadId = null, scanResultId = null, scanInputHash }) {
  return {
    mode: "cheap",
    sourceOfTruth: scanResultId ? "scanResult" : "lead",
    status: "evidence_pending",
    leadId,
    scanResultId,
    scanInputHash,
    detectorVersion,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    signals: {}
  };
}

export function staleCheapEvidence(existing = {}, reason = "scan_input_or_detector_changed") {
  return {
    ...existing,
    mode: "cheap",
    status: "evidence_stale",
    staleReason: reason,
    staleAt: new Date().toISOString(),
    detectorVersion: existing.detectorVersion || detectorVersion
  };
}

function publicEvidencePath(filePath) {
  return `/uploads/evidence/${path.basename(filePath)}`;
}

function blankSignal(key, overrides = {}) {
  return {
    key,
    label: signalLabels[key] || key,
    value: "unknown",
    confidence: 0,
    source: "dom",
    evidence: "Signal was not evaluated.",
    region: null,
    textRead: null,
    scrollDepth: null,
    detectorVersion,
    ...overrides
  };
}

function evidenceSignal(key, { value, confidence, source, evidence, region = null, textRead = null, scrollDepth = null }) {
  let safeValue = value;
  let safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  if (safeValue === "absent" && safeConfidence < 0.82) {
    safeValue = "unknown";
    safeConfidence = Math.min(safeConfidence, 0.5);
  }
  if ((source === "vision" || source === "dom+vision") && safeValue === "present" && !region) {
    safeValue = "unknown";
    safeConfidence = Math.min(safeConfidence, 0.45);
  }
  if ((source === "vision" || source === "dom+vision") && safeValue === "present" && !compactText(evidence)) {
    safeValue = "unknown";
    safeConfidence = Math.min(safeConfidence, 0.45);
  }
  return {
    key,
    label: signalLabels[key] || key,
    value: safeValue,
    confidence: Number(safeConfidence.toFixed(2)),
    source,
    evidence,
    region,
    textRead,
    scrollDepth,
    detectorVersion
  };
}

function present(key, source, evidence, confidence = 0.9, extra = {}) {
  return evidenceSignal(key, { value: "present", source, evidence, confidence, ...extra });
}

function absent(key, source, evidence, confidence = 0.86, extra = {}) {
  return evidenceSignal(key, { value: "absent", source, evidence, confidence, ...extra });
}

function unknown(key, source, evidence, confidence = 0.25, extra = {}) {
  return evidenceSignal(key, { value: "unknown", source, evidence, confidence, ...extra });
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countMatchingLinks(links = [], pattern) {
  return links.filter((href) => pattern.test(href)).length;
}

function pageTypeCounts(extracted) {
  const links = extracted.links || [];
  const serviceCount = countMatchingLinks(links, /service|treatment|practice|solution|what-we-do|procedure|dental|clinic|renovation|interior|menu|repair|quote/i);
  const projectCount = countMatchingLinks(links, /portfolio|project|case-study|case-studies|gallery|before-after|beforeafter|our-work|renovation|testimonial/i);
  return { serviceCount, projectCount };
}

function detectBasicSeo(extracted) {
  const hasTitle = compactText(extracted.title).length >= 8;
  const hasMeta = compactText(extracted.metaDescription).length >= 40;
  const hasH1 = (extracted.headings || []).some((heading) => compactText(heading).length >= 5);
  return { hasTitle, hasMeta, hasH1 };
}

function cheapSignalsFromExtracted(extracted, perf = {}, failed = false) {
  if (failed) {
    return Object.fromEntries([
      "phoneVisible",
      "emailVisible",
      "whatsappLinkPresent",
      "contactFormPresent",
      "bookingFormPresent",
      "servicePagesPresent",
      "projectCaseStudyPagesPresent",
      "socialLinksPresent",
      "basicSeoPresent",
      "pageSpeedUsable",
      "techStackDetected"
    ].map((key) => [key, unknown(key, "dom", "Cheap evidence scan failed; signal left unknown.")]));
  }

  const socialLinks = extracted.socialLinks || [];
  const forms = extracted.forms || [];
  const ctas = extracted.ctas || [];
  const links = extracted.links || [];
  const visibleText = compactText(extracted.visibleText);
  const tech = extracted.techStack || detectTech({ html: "", scripts: extracted.scripts || [], links });
  const { serviceCount, projectCount } = pageTypeCounts(extracted);
  const seo = detectBasicSeo(extracted);
  const hasBooking = forms.some((form) => /book|appointment|schedule|reserve|booking|consult/i.test(`${form.action || ""} ${(form.fields || []).join(" ")}`)) ||
    ctas.some((cta) => /book|appointment|schedule|reserve|consult/i.test(`${cta.text || ""} ${cta.href || ""}`));
  const hasContactForm = forms.some((form) => /contact|enquiry|inquiry|message|email|phone|name/i.test(`${form.action || ""} ${(form.fields || []).join(" ")}`));
  const speed = Number(perf.loadTime || 0);
  const techHits = Object.entries(tech).filter(([key, value]) => key !== "cms" && Boolean(value)).length + (tech.cms ? 1 : 0);

  return {
    phoneVisible: (extracted.phones || []).length
      ? present("phoneVisible", "dom", `Phone-like text found: ${(extracted.phones || []).slice(0, 2).join(", ")}`, 0.92, { textRead: (extracted.phones || [])[0] || null })
      : absent("phoneVisible", "dom", "No phone-like text found in homepage/contact DOM text.", visibleText.length > 400 ? 0.86 : 0.55),
    emailVisible: (extracted.emails || []).length
      ? present("emailVisible", "dom", `Email found: ${(extracted.emails || [])[0]}`, 0.95, { textRead: (extracted.emails || [])[0] || null })
      : absent("emailVisible", "dom", "No email address found in homepage/contact DOM text.", visibleText.length > 400 ? 0.86 : 0.55),
    whatsappLinkPresent: socialLinks.some((href) => /wa\.me|whatsapp/i.test(href)) || links.some((href) => /wa\.me|whatsapp/i.test(href))
      ? present("whatsappLinkPresent", "dom", "WhatsApp link found in page links.", 0.95)
      : absent("whatsappLinkPresent", "dom", "No WhatsApp link found in page links.", links.length > 15 ? 0.86 : 0.5),
    contactFormPresent: hasContactForm
      ? present("contactFormPresent", "dom", "Contact-like form fields found.", 0.9, { textRead: forms[0]?.fields?.join(", ") || null })
      : absent("contactFormPresent", "dom", "No contact-like form found on homepage/contact page.", forms.length === 0 ? 0.84 : 0.65),
    bookingFormPresent: hasBooking
      ? present("bookingFormPresent", "dom", "Booking/appointment CTA or form found.", 0.88)
      : absent("bookingFormPresent", "dom", "No booking/appointment form or CTA found.", ctas.length > 0 || forms.length > 0 ? 0.84 : 0.6),
    servicePagesPresent: serviceCount > 0
      ? present("servicePagesPresent", "dom", `${serviceCount} service-like links found.`, Math.min(0.95, 0.72 + serviceCount * 0.04), { textRead: `${serviceCount}` })
      : absent("servicePagesPresent", "dom", "No service-like links found in page links.", links.length > 20 ? 0.84 : 0.55),
    projectCaseStudyPagesPresent: projectCount > 0
      ? present("projectCaseStudyPagesPresent", "dom", `${projectCount} project/case-study-like links found.`, Math.min(0.95, 0.72 + projectCount * 0.05), { textRead: `${projectCount}` })
      : absent("projectCaseStudyPagesPresent", "dom", "No project, portfolio, gallery, or case-study links found.", links.length > 20 ? 0.84 : 0.55),
    socialLinksPresent: socialLinks.length
      ? present("socialLinksPresent", "dom", `${socialLinks.length} social links found.`, 0.94, { textRead: socialLinks.slice(0, 3).join(", ") })
      : absent("socialLinksPresent", "dom", "No social links found.", links.length > 20 ? 0.86 : 0.55),
    basicSeoPresent: seo.hasTitle && seo.hasMeta && seo.hasH1
      ? present("basicSeoPresent", "dom", "Title, meta description, and heading found.", 0.9)
      : absent("basicSeoPresent", "dom", `Missing: ${[!seo.hasTitle && "title", !seo.hasMeta && "meta description", !seo.hasH1 && "heading"].filter(Boolean).join(", ")}`, 0.86),
    pageSpeedUsable: speed && speed < 3500
      ? present("pageSpeedUsable", "pagespeed", `DOM loaded in ${speed}ms.`, speed < 1800 ? 0.9 : 0.78, { textRead: `${speed}ms` })
      : speed
        ? absent("pageSpeedUsable", "pagespeed", `DOM loaded slowly in ${speed}ms.`, 0.86, { textRead: `${speed}ms` })
        : unknown("pageSpeedUsable", "pagespeed", "PageSpeed timing was not available."),
    techStackDetected: techHits
      ? present("techStackDetected", "dom", `Detected ${tech.cms || "site"} stack signals.`, 0.88, { textRead: JSON.stringify(tech) })
      : unknown("techStackDetected", "dom", "No recognizable CMS, analytics, booking, marketing, or chat stack detected.", 0.45)
  };
}

export function buildCheapEvidencePayloadFromExtracted(extracted = {}, perf = {}, failed = false, error = null, meta = {}) {
  const signals = cheapSignalsFromExtracted(extracted, perf, failed);
  return {
    detectorVersion,
    scanInputHash: meta.scanInputHash || createScanInputHash({
      website: meta.website,
      statusCode: perf.statusCode,
      loadTime: perf.loadTime,
      rawExtractedData: extracted
    }),
    leadId: meta.leadId || null,
    scanResultId: meta.scanResultId || null,
    sourceOfTruth: meta.scanResultId ? "scanResult" : "lead",
    mode: "cheap",
    scannedAt: new Date().toISOString(),
    status: failed ? "evidence_failed_fallback" : "evidence_complete",
    ...(failed ? { error, fallbackReason: "detector_error", reviewRequired: true } : {}),
    signals,
    summary: failed ? { source: "dom/pagespeed", failed: true } : {
      source: "dom/pagespeed",
      loadTime: perf.loadTime,
      statusCode: perf.statusCode,
      servicePageCount: Number(signals.servicePagesPresent.textRead || 0),
      projectCaseStudyPageCount: Number(signals.projectCaseStudyPagesPresent.textRead || 0)
    }
  };
}

async function readScanResultJob(job) {
  const scanResult = await prisma.scanResult.findUnique({
    where: { id: job.scanResultId },
    select: {
      id: true,
      website: true,
      statusCode: true,
      loadTime: true,
      rawExtractedData: true,
      scanEvidence: true
    }
  });
  if (!scanResult) return null;
  return scanResult;
}

function isStillCurrent(currentEvidence, job) {
  return currentEvidence?.scanInputHash === job.scanInputHash &&
    currentEvidence?.detectorVersion === job.detectorVersion &&
    ["evidence_pending", "evidence_stale"].includes(currentEvidence?.status);
}

async function writeScanResultEvidence(job, payload) {
  const current = await readScanResultJob(job);
  if (!current || !isStillCurrent(current.scanEvidence, job)) return { discarded: true, reason: "stale-on-arrival" };
  await prisma.scanResult.update({ where: { id: job.scanResultId }, data: { scanEvidence: payload } });
  if (job.leadId) {
    await prisma.lead.update({ where: { id: job.leadId }, data: { scanEvidence: payload } }).catch(() => {});
  }
  return { discarded: false };
}

async function markEvidenceFallback(job, error) {
  const current = await readScanResultJob(job);
  if (!current || !isStillCurrent(current.scanEvidence, job)) return { discarded: true, reason: "stale-on-arrival" };
  const payload = buildCheapEvidencePayloadFromExtracted({}, {}, true, error.message, {
    leadId: job.leadId,
    scanResultId: job.scanResultId,
    scanInputHash: job.scanInputHash,
    website: current.website
  });
  return writeScanResultEvidence(job, payload);
}

export async function runQueuedCheapEvidenceJob(job) {
  if (!job.scanResultId || !job.scanInputHash || !job.detectorVersion) throw new Error("Evidence job is missing required freshness stamps");
  for (let attempt = 0; attempt <= transientRetryDelays.length; attempt += 1) {
    try {
      const current = await readScanResultJob(job);
      if (!current) return { discarded: true, reason: "scan-result-missing" };
      if (!isStillCurrent(current.scanEvidence, job)) return { discarded: true, reason: "stale-on-arrival" };
      if (process.env.EVIDENCE_FORCE_FAILURE === "true") throw new Error("Forced evidence worker failure");
      const payload = buildCheapEvidencePayloadFromExtracted(
        current.rawExtractedData || {},
        { loadTime: current.loadTime, statusCode: current.statusCode },
        false,
        null,
        {
          leadId: job.leadId,
          scanResultId: job.scanResultId,
          scanInputHash: job.scanInputHash,
          website: current.website
        }
      );
      return writeScanResultEvidence(job, payload);
    } catch (error) {
      if (attempt >= transientRetryDelays.length) return markEvidenceFallback(job, error);
      await sleep(transientRetryDelays[attempt]);
    }
  }
  return { discarded: true, reason: "unreachable" };
}

async function extractWithBrowser(website, { fullPageScreenshots = false, leadId = "manual" } = {}) {
  await fs.mkdir(evidenceShotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
    const started = Date.now();
    const response = await page.goto(normalizeWebsiteRoot(website), { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(1200);
    const loadTime = Date.now() - started;
    let extracted = await extractPageData(page, website, fullPageScreenshots ? "DEEP" : "FULL");
    if (extracted.contactPageUrl) {
      try {
        await page.goto(extracted.contactPageUrl, { waitUntil: "domcontentloaded", timeout: 16000 });
        await sleep(700);
        const contact = await extractPageData(page, extracted.contactPageUrl, "FULL");
        extracted = mergeExtractedData(extracted, contact);
      } catch {
        // Keep homepage evidence rather than marking contact-page signals absent.
      }
    }
    let desktopScreenshot = null;
    let mobileScreenshot = null;
    if (fullPageScreenshots) {
      await page.goto(normalizeWebsiteRoot(website), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await sleep(700);
      const desktopFile = path.join(evidenceShotDir, `${leadId}-${Date.now()}-desktop-full.png`);
      await page.screenshot({ path: desktopFile, type: "png", fullPage: true });
      desktopScreenshot = publicEvidencePath(desktopFile);
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(700);
      const mobileFile = path.join(evidenceShotDir, `${leadId}-${Date.now()}-mobile-full.png`);
      await page.screenshot({ path: mobileFile, type: "png", fullPage: true });
      mobileScreenshot = publicEvidencePath(mobileFile);
    }
    return { extracted, perf: { loadTime, statusCode: response?.status() || null }, page, desktopScreenshot, mobileScreenshot };
  } finally {
    await page?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function runCheapEvidenceScan(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw notFound("Lead not found");
  if (!lead.website) throw new HttpError(422, "Lead website is required");
  let payload;
  try {
    const { extracted, perf } = await extractWithBrowser(lead.website, { fullPageScreenshots: false, leadId });
    payload = buildCheapEvidencePayloadFromExtracted(extracted, perf, false, null, { leadId, website: lead.website });
  } catch (error) {
    payload = buildCheapEvidencePayloadFromExtracted({}, {}, true, error.message, { leadId, website: lead.website });
  }
  const latestScanResult = await prisma.scanResult.findFirst({
    where: { website: normalizeWebsiteRoot(lead.website) },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const syncedPayload = latestScanResult
    ? { ...payload, scanResultId: latestScanResult.id, sourceOfTruth: "scanResult" }
    : payload;
  if (latestScanResult) {
    await prisma.scanResult.update({ where: { id: latestScanResult.id }, data: { scanEvidence: syncedPayload } });
  }
  return prisma.lead.update({ where: { id: leadId }, data: { scanEvidence: syncedPayload } });
}

function textCorroborated(textRead, domText) {
  const text = compactText(textRead).toLowerCase();
  if (!text || text.length < 4) return false;
  return compactText(domText).toLowerCase().includes(text.slice(0, Math.min(text.length, 80)));
}

function confidenceFromGrounding({ region, textRead, domCorroborates, multi = false, base = 0.45 }) {
  let confidence = base;
  if (region) confidence += 0.2;
  if (textRead) confidence += 0.15;
  if (domCorroborates) confidence += 0.18;
  if (multi) confidence += 0.08;
  return Math.min(0.97, confidence);
}

async function visualDomCandidates(page) {
  return page.evaluate(() => {
    const viewportHeight = window.innerHeight || 1;
    const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, viewportHeight);
    const patterns = {
      awardsVisible: /award|winner|best|featured|press|recognised|recognized|straits times|top rated|ranked/i,
      trustBadgesVisible: /trusted|guarantee|verified|licensed|insured|accredited|safe|secure|bizsafe|iso|badge/i,
      certificationsVisible: /certified|certification|licensed|licence|accredited|bizsafe|iso|qualified|member of/i,
      testimonialsVisible: /testimonial|what clients say|success stories|client feedback/i,
      reviewsVisible: /reviews?|rating|stars?|google reviews?|facebook reviews?/i,
      ctaVisible: /book|schedule|reserve|contact|enquire|inquire|quote|consultation|get started|call now|whatsapp/i,
      portfolioProjectVisuals: /portfolio|project|case stud|gallery|our work|completed|renovation/i,
      beforeAfterVisuals: /before|after|transformation|results/i
    };
    const nodes = Array.from(document.querySelectorAll("a,button,h1,h2,h3,h4,p,span,div,img,section"));
    const out = {};
    Object.keys(patterns).forEach((key) => {
      const candidates = [];
      for (const el of nodes) {
        const text = `${el.innerText || el.textContent || ""} ${el.alt || ""} ${el.getAttribute?.("aria-label") || ""} ${el.className || ""}`.trim();
        if (!text || !patterns[key].test(text)) continue;
        const rect = el.getBoundingClientRect();
        const absoluteY = rect.top + window.scrollY;
        if (rect.width < 4 || rect.height < 4) continue;
        candidates.push({
          textRead: text.replace(/\s+/g, " ").slice(0, 180),
          region: [Math.round(rect.left + window.scrollX), Math.round(absoluteY), Math.round(rect.width), Math.round(rect.height)],
          scrollDepth: Number(Math.min(1, absoluteY / docHeight).toFixed(2))
        });
      }
      out[key] = candidates.slice(0, 5);
    });
    return out;
  });
}

function visionSignalFromCandidates(key, candidates, domText) {
  const first = candidates?.[0];
  if (!first) {
    return unknown(key, "vision", "No grounded visual region found; signal left unknown.", 0.32);
  }
  const isTextClaim = !["portfolioProjectVisuals", "beforeAfterVisuals", "ctaVisible"].includes(key);
  const corroborates = textCorroborated(first.textRead, domText);
  if (isTextClaim && !corroborates) {
    return unknown(key, "vision", "Visual text candidate was not corroborated by DOM text, so the claim was downgraded to unknown.", 0.42, {
      region: first.region,
      textRead: first.textRead,
      scrollDepth: first.scrollDepth
    });
  }
  const confidence = confidenceFromGrounding({
    region: first.region,
    textRead: first.textRead,
    domCorroborates: corroborates || !isTextClaim,
    multi: candidates.length > 1,
    base: key === "ctaVisible" ? 0.5 : 0.46
  });
  return present(key, isTextClaim ? "dom+vision" : "vision", `${signalLabels[key]} candidate found in full-page screenshot/DOM region.`, confidence, {
    region: first.region,
    textRead: first.textRead,
    scrollDepth: first.scrollDepth
  });
}

export async function runVisionEvidenceScan(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw notFound("Lead not found");
  if (!lead.website) throw new HttpError(422, "Lead website is required");
  let browser;
  let page;
  try {
    await fs.mkdir(evidenceShotDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
    await page.goto(normalizeWebsiteRoot(lead.website), { waitUntil: "domcontentloaded", timeout: 35000 });
    await sleep(1500);
    const extracted = await extractPageData(page, lead.website, "DEEP");
    const desktopFile = path.join(evidenceShotDir, `${leadId}-${Date.now()}-desktop-full.png`);
    await page.screenshot({ path: desktopFile, type: "png", fullPage: true });
    const candidates = await visualDomCandidates(page);
    const visionSignals = Object.fromEntries(Object.keys(signalLabels)
      .filter((key) => ["awardsVisible", "trustBadgesVisible", "certificationsVisible", "testimonialsVisible", "reviewsVisible", "ctaVisible", "portfolioProjectVisuals", "beforeAfterVisuals"].includes(key))
      .map((key) => [key, visionSignalFromCandidates(key, candidates[key] || [], extracted.visibleText || "")]));
    const firstCta = visionSignals.ctaVisible;
    const merged = {
      ...(lead.scanEvidence || {}),
      detectorVersion,
      mode: "vision",
      visionScannedAt: new Date().toISOString(),
      status: "COMPLETED",
      fullPageScreenshotPath: publicEvidencePath(desktopFile),
      signals: {
        ...((lead.scanEvidence || {}).signals || {}),
        ...visionSignals,
        firstCtaScrollDepth: firstCta?.scrollDepth != null
          ? present("firstCtaScrollDepth", firstCta.source, `First CTA observed at ${Math.round(firstCta.scrollDepth * 100)}% page depth.`, firstCta.confidence, { region: firstCta.region, textRead: firstCta.textRead, scrollDepth: firstCta.scrollDepth })
          : unknown("firstCtaScrollDepth", "vision", "No grounded CTA region found."),
        awardsBadgesScrollDepth: (() => {
          const found = [visionSignals.awardsVisible, visionSignals.trustBadgesVisible, visionSignals.certificationsVisible].find((item) => item.value === "present" && item.scrollDepth != null);
          return found
            ? present("awardsBadgesScrollDepth", found.source, `Award/badge/certification evidence observed at ${Math.round(found.scrollDepth * 100)}% page depth.`, found.confidence, { region: found.region, textRead: found.textRead, scrollDepth: found.scrollDepth })
            : unknown("awardsBadgesScrollDepth", "vision", "No grounded award, badge, or certification region found.");
        })()
      }
    };
    return prisma.lead.update({ where: { id: leadId }, data: { scanEvidence: merged } });
  } catch (error) {
    const existing = lead.scanEvidence || {};
    const failed = {
      ...existing,
      detectorVersion,
      mode: "vision",
      visionScannedAt: new Date().toISOString(),
      status: "FAILED",
      reviewRequired: true,
      error: error.message,
      signals: {
        ...(existing.signals || {}),
        awardsVisible: unknown("awardsVisible", "vision", "Vision scan failed; signal left unknown."),
        trustBadgesVisible: unknown("trustBadgesVisible", "vision", "Vision scan failed; signal left unknown."),
        certificationsVisible: unknown("certificationsVisible", "vision", "Vision scan failed; signal left unknown.")
      }
    };
    return prisma.lead.update({ where: { id: leadId }, data: { scanEvidence: failed } });
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export async function getEvidence(leadId, userId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, company: true, website: true, scanEvidence: true }
  });
  if (!lead) throw notFound("Lead not found");
  const scanResult = lead.website ? await prisma.scanResult.findFirst({
    where: { website: normalizeWebsiteRoot(lead.website) },
    orderBy: { createdAt: "desc" },
    select: { id: true, scanEvidence: true, createdAt: true }
  }).catch(() => null) : null;
  const corrections = await prisma.evidenceCorrection.findMany({
    where: { leadId },
    orderBy: { updatedAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
  return {
    ...lead,
    scanEvidence: scanResult?.scanEvidence || lead.scanEvidence,
    machineEvidenceSource: scanResult?.scanEvidence ? "scanResult" : "lead",
    canonicalScanResultId: scanResult?.id || null,
    corrections,
    userId
  };
}

export async function correctEvidence(leadId, userId, input) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw notFound("Lead not found");
  if (!["present", "absent", "unknown"].includes(input.value)) throw new HttpError(422, "Correction value must be present, absent, or unknown");
  return prisma.evidenceCorrection.upsert({
    where: { leadId_signalKey: { leadId, signalKey: input.signalKey } },
    create: {
      leadId,
      signalKey: input.signalKey,
      value: input.value,
      notes: input.notes || null,
      correctedBy: userId
    },
    update: {
      value: input.value,
      notes: input.notes || null,
      correctedBy: userId
    },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

export function measureEvidenceAccuracy(labelledSet = [], predictionsByUrl = {}) {
  const signals = ["awardsVisible", "trustBadgesVisible", "certificationsVisible", "testimonialsVisible", "reviewsVisible", "ctaVisible", "phoneVisible", "emailVisible", "whatsappLinkPresent"];
  const metrics = {};
  for (const signal of signals) {
    let tp = 0; let fp = 0; let fn = 0; let tn = 0; let unknowns = 0;
    for (const row of labelledSet) {
      const expected = row.labels?.[signal];
      if (!["present", "absent"].includes(expected)) continue;
      const predicted = predictionsByUrl[row.url]?.[signal]?.value || "unknown";
      if (predicted === "unknown") {
        unknowns += 1;
      } else if (predicted === "present" && expected === "present") tp += 1;
      else if (predicted === "present" && expected === "absent") fp += 1;
      else if (predicted === "absent" && expected === "present") fn += 1;
      else if (predicted === "absent" && expected === "absent") tn += 1;
    }
    metrics[signal] = {
      precision: tp + fp ? Number((tp / (tp + fp)).toFixed(3)) : null,
      recall: tp + fn ? Number((tp / (tp + fn)).toFixed(3)) : null,
      tp, fp, fn, tn, unknowns
    };
  }
  return metrics;
}
