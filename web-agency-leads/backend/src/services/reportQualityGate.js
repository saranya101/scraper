import fs from "node:fs/promises";
import { absoluteUploadPath } from "./websiteScannerService.js";
import { fileExistsFromUploadUrl } from "./screenshotService.js";

const placeholderPatterns = [/lorem ipsum/i, /\bplaceholder\b/i, /\byour company here\b/i];
const guaranteePatterns = [/guarantee/i, /10x/i, /increase revenue by \d/i, /thousands of dollars/i, /300%/i];
const genericPatterns = [
  /improve your website design/i,
  /add better seo/i,
  /use clearer ctas/i,
  /improve user experience/i,
  /post more on social media/i
];

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function pdfExists(pdfUrl) {
  if (!pdfUrl) return false;
  try {
    const filePath = absoluteUploadPath(pdfUrl);
    const stat = await fs.stat(filePath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

export async function runReportQualityGate(report) {
  const failedChecks = [];
  const warnings = [];
  const selectedServices = Array.isArray(report.selectedServices) ? report.selectedServices : [];
  const sections = Array.isArray(report.serviceSections) ? report.serviceSections : [];
  const bodyText = [
    report.executiveSummary,
    ...sections.flatMap((section) => [
      section.serviceSummary,
      ...(section.businessProblems || []).flatMap((problem) => [
        problem.title,
        ...(problem.evidence || []),
        problem.whyItMatters,
        problem.recommendedImprovement,
        problem.expectedImpact
      ]),
      ...(section.priorityActions || []).flatMap((action) => [action.action, action.reason])
    ]),
    ...(report.finalActionPlan || []).flatMap((step) => [step.title, step.description]),
    report.cta
  ].map(text).join("\n");

  if (!text(report.lead?.businessName)) failedChecks.push("missing_business_name");
  if (!text(report.lead?.websiteUrl)) failedChecks.push("missing_website_url");
  if (!selectedServices.length) failedChecks.push("missing_selected_services");
  if (!sections.length) failedChecks.push("missing_service_sections");
  if (!text(report.cta)) failedChecks.push("missing_cta");
  if (placeholderPatterns.some((pattern) => pattern.test(bodyText))) failedChecks.push("placeholder_text_detected");
  if (guaranteePatterns.some((pattern) => pattern.test(bodyText))) failedChecks.push("extreme_claim_detected");
  if (genericPatterns.some((pattern) => pattern.test(bodyText))) failedChecks.push("generic_advice_detected");
  if (!report.pdfUrl || !(await pdfExists(report.pdfUrl))) failedChecks.push("empty_or_missing_pdf");

  for (const service of selectedServices) {
    const section = sections.find((item) => item.serviceId === service.id);
    if (!section) {
      failedChecks.push(`missing_section_${service.id}`);
      continue;
    }
    if ((section.businessProblems || []).length < 2) failedChecks.push(`not_enough_problems_${service.id}`);
    if ((section.businessProblems || []).filter((problem) => text(problem.recommendedImprovement)).length < 2) failedChecks.push(`not_enough_improvements_${service.id}`);
    if ((section.priorityActions || []).length < 1) failedChecks.push(`missing_priority_action_${service.id}`);
  }

  const screenshotPaths = sections.flatMap((section) => (section.businessProblems || []).map((problem) => problem.screenshotPath).filter(Boolean));
  for (const screenshotPath of screenshotPaths) {
    if (!(await fileExistsFromUploadUrl(screenshotPath))) {
      failedChecks.push("broken_screenshot_path");
      break;
    }
  }

  if ((report.executiveSummary || "").length < 80) warnings.push("Executive summary is very short.");
  if (sections.some((section) => /limited .* evidence/i.test(text(section.serviceSummary)))) warnings.push("One or more service sections were generated with limited direct evidence.");

  return {
    passed: failedChecks.length === 0,
    status: failedChecks.length ? "failed_quality_gate" : "generated",
    failedChecks,
    warnings,
    checkedAt: new Date().toISOString(),
    summary: failedChecks.length
      ? "Report failed quality gate and should not be attached to outreach yet."
      : "Report passed quality gate and is ready for approval."
  };
}
