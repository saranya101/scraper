import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizeWebsiteRoot } from "../utils/priority.js";
import { extractPageData, mergeExtractedData } from "./extractionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, "../../uploads");
const screenshotDir = path.join(uploadsDir, "screenshots");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicPath(filePath) {
  return `/uploads/screenshots/${path.basename(filePath)}`;
}

function classifyAccess({ url, statusCode, errorMessage, text }) {
  const body = String(text || "").toLowerCase();
  const message = String(errorMessage || "").toLowerCase();
  if (!url) return { websiteStatus: "NO_WEBSITE", accessIssue: "No Website", accessIssueReason: "No website URL found from Google Places." };
  if (message.includes("timeout")) return { websiteStatus: "TIMEOUT", accessIssue: "Timeout", accessIssueReason: errorMessage };
  if (message.includes("ssl") || message.includes("certificate")) return { websiteStatus: "SSL_ERROR", accessIssue: "SSL Error", accessIssueReason: errorMessage };
  if (message.includes("redirect")) return { websiteStatus: "REDIRECT_LOOP", accessIssue: "Redirect Loop", accessIssueReason: errorMessage };
  if (statusCode === 403) return { websiteStatus: "FORBIDDEN", accessIssue: "403 Forbidden", accessIssueReason: "The website blocked access." };
  if (statusCode === 404) return { websiteStatus: "NOT_FOUND", accessIssue: "404 Not Found", accessIssueReason: "The website returned a not found page." };
  if (statusCode >= 500) return { websiteStatus: "SERVER_ERROR", accessIssue: "Server Error", accessIssueReason: `The website returned HTTP ${statusCode}.` };
  if (body.includes("cloudflare")) return { websiteStatus: "CLOUDFLARE", accessIssue: "Cloudflare", accessIssueReason: "Cloudflare challenge or interstitial detected." };
  if (body.includes("captcha") || body.includes("recaptcha")) return { websiteStatus: "CAPTCHA", accessIssue: "CAPTCHA", accessIssueReason: "CAPTCHA text detected on page." };
  if (body.includes("checking your browser") || body.includes("bot protection")) return { websiteStatus: "BOT_PROTECTION", accessIssue: "Bot Protection", accessIssueReason: "Bot protection page detected." };
  if (body.includes("domain for sale") || body.includes("buy this domain") || body.includes("parked")) return { websiteStatus: "DOMAIN_PARKED", accessIssue: "Domain Parked", accessIssueReason: "Domain parking text detected." };
  if (!statusCode) return { websiteStatus: "WEBSITE_OFFLINE", accessIssue: "Website Offline", accessIssueReason: errorMessage || "Website did not respond." };
  return { websiteStatus: "WORKING", accessIssue: null, accessIssueReason: null };
}

export function absoluteUploadPath(imagePath) {
  return path.join(uploadsDir, imagePath.replace(/^\/?uploads\/?/, ""));
}

export async function createBrowser() {
  await fs.mkdir(screenshotDir, { recursive: true });
  return chromium.launch({ headless: true });
}

export async function scanWebsite(browser, business, scanJobId, scanDepth = "QUICK") {
  if (!business.website) {
    return {
      ...classifyAccess({ url: null }),
      statusCode: null,
      visibleText: "",
      screenshotPath: null,
      mobileScreenshotPath: null,
      loadTime: null,
      sslValid: null,
      redirectCount: 0,
      extracted: {}
    };
  }

  const website = normalizeWebsiteRoot(business.website);
  const desktopFile = path.join(screenshotDir, `${scanJobId}-${Date.now()}-desktop.jpg`);
  const mobileFile = desktopFile.replace("-desktop.jpg", "-mobile.jpg");
  let page;

  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    let redirectCount = 0;
    page.on("response", (response) => {
      const status = response.status();
      if ([301, 302, 303, 307, 308].includes(status)) redirectCount += 1;
    });
    const startedAt = Date.now();
    const response = await page.goto(website, { waitUntil: "domcontentloaded", timeout: scanDepth === "DEEP" ? 40000 : 25000 });
    const loadTime = Date.now() - startedAt;
    await sleep(scanDepth === "QUICK" ? 800 : 1500);
    const statusCode = response?.status() || null;
    let extracted = await extractPageData(page, website, scanDepth).catch(() => ({ visibleText: "" }));
    await page.screenshot({ path: desktopFile, type: "jpeg", quality: 62, fullPage: scanDepth === "DEEP" });
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(500);
    await page.screenshot({ path: mobileFile, type: "jpeg", quality: 62, fullPage: scanDepth === "DEEP" });
    if (extracted.contactPageUrl) {
      try {
        await page.goto(extracted.contactPageUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
        await sleep(500);
        const contactExtracted = await extractPageData(page, extracted.contactPageUrl, scanDepth);
        extracted = mergeExtractedData(extracted, contactExtracted);
      } catch {
        extracted = mergeExtractedData(extracted, null);
      }
    }
    const access = classifyAccess({ url: website, statusCode, text: extracted.visibleText });
    return {
      ...access,
      website,
      statusCode,
      visibleText: extracted.visibleText || "",
      screenshotPath: publicPath(desktopFile),
      mobileScreenshotPath: publicPath(mobileFile),
      loadTime,
      sslValid: page.url().startsWith("https://"),
      redirectCount,
      extracted
    };
  } catch (error) {
    return {
      ...classifyAccess({ url: website, errorMessage: error.message }),
      website,
      statusCode: null,
      visibleText: "",
      screenshotPath: null,
      mobileScreenshotPath: null,
      loadTime: null,
      sslValid: error.message ? false : null,
      redirectCount: 0,
      extracted: {}
    };
  } finally {
    await page?.close().catch(() => {});
  }
}
