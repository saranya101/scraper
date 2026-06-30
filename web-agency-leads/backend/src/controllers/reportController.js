import path from "node:path";
import * as reportService from "../services/reportService.js";

function reportFilename(report, filePath) {
  const company = report.lead?.company || "website-audit";
  const safeCompany = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "website-audit";
  return `${safeCompany}-website-opportunity-report${path.extname(filePath) || ".pdf"}`;
}

export async function generate(req, res) {
  res.status(201).json(await reportService.generateReport(req.params.leadId, req.user.id, req.body || {}));
}

export async function latest(req, res) {
  const report = await reportService.getReportForLead(req.params.leadId, req.user.id);
  res.json(report || null);
}

export async function approve(req, res) {
  res.json(await reportService.approveReport(req.params.leadId, req.user.id));
}

export async function regenerate(req, res) {
  res.status(201).json(await reportService.regenerateReport(req.params.leadId, req.user.id, req.body || {}));
}

export async function get(req, res) {
  res.json(await reportService.getReport(req.params.reportId, req.user.id));
}

export async function download(req, res) {
  const { report, filePath } = await reportService.downloadReport(req.params.reportId, req.user.id);
  res.download(filePath, reportFilename(report, filePath));
}

export async function downloadForLead(req, res) {
  const { report, filePath } = await reportService.downloadReportByLead(req.params.leadId, req.user.id);
  res.download(filePath, reportFilename(report, filePath));
}

export async function previewForLead(req, res) {
  const { report, filePath } = await reportService.downloadReportByLead(req.params.leadId, req.user.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${reportFilename(report, filePath)}"`);
  res.sendFile(filePath);
}
