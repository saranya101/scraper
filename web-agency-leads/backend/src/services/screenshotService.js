import fs from "node:fs/promises";
import path from "node:path";
import { absoluteUploadPath, createBrowser, scanWebsite } from "./websiteScannerService.js";

function toPublicPath(value) {
  if (!value) return null;
  if (String(value).startsWith("/uploads/")) return value;
  return `/uploads/${String(value).replace(/^\/+/, "")}`;
}

async function existingPublicAsset(value) {
  if (!value) return null;
  try {
    const absolute = absoluteUploadPath(value);
    await fs.access(absolute);
    return toPublicPath(value);
  } catch {
    return null;
  }
}

export async function ensureReportScreenshots(lead) {
  const debug = [];
  const existing = {
    homepage: await existingPublicAsset(lead.screenshotPath),
    mobile: await existingPublicAsset(lead.mobileScreenshotPath)
  };

  if (existing.homepage || existing.mobile) {
    debug.push({
      level: "info",
      step: "reuse_existing_screenshots",
      message: "Using screenshots already stored on the lead record."
    });
    return {
      screenshots: existing,
      status: existing.homepage && existing.mobile ? "available" : "partial",
      warnings: existing.homepage && existing.mobile ? [] : ["One or more screenshots were missing, so the report will render with partial visual evidence."],
      logs: debug
    };
  }

  let browser = null;
  try {
    debug.push({
      level: "info",
      step: "capture_report_screenshots",
      message: "No stored screenshots were available, so a fresh capture was attempted."
    });
    browser = await createBrowser();
    const capture = await scanWebsite(browser, { website: lead.website }, `report-${lead.id}`, "QUICK");
    return {
      screenshots: {
        homepage: capture.screenshotPath || null,
        mobile: capture.mobileScreenshotPath || null
      },
      status: capture.screenshotPath || capture.mobileScreenshotPath ? "captured" : "missing",
      warnings: capture.screenshotPath || capture.mobileScreenshotPath ? [] : ["Screenshot capture did not return usable images. The report was generated without screenshots."],
      logs: [
        ...debug,
        {
          level: capture.screenshotPath || capture.mobileScreenshotPath ? "info" : "warn",
          step: "capture_result",
          message: capture.screenshotPath || capture.mobileScreenshotPath
            ? "Fresh screenshots were captured for the report."
            : capture.accessIssueReason || "Capture completed without usable screenshots."
        }
      ]
    };
  } catch (error) {
    return {
      screenshots: { homepage: null, mobile: null },
      status: "failed",
      warnings: ["Screenshot capture failed. The report was generated without screenshots."],
      logs: [
        ...debug,
        {
          level: "error",
          step: "capture_failed",
          message: error.message || "Screenshot capture failed."
        }
      ]
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function fileExistsFromUploadUrl(value) {
  if (!value) return false;
  try {
    const absolute = absoluteUploadPath(value);
    await fs.access(path.resolve(absolute));
    return true;
  } catch {
    return false;
  }
}
