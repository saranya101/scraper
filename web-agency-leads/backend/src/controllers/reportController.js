import path from "node:path";
import * as reportService from "../services/reportService.js";

export async function generate(req, res) {
  res.status(201).json(await reportService.generateReport(req.params.leadId, req.user.id));
}

export async function latest(req, res) {
  const report = await reportService.latestForLead(req.params.leadId, req.user.id);
  res.json(report || null);
}

export async function get(req, res) {
  res.json(await reportService.getReport(req.params.reportId, req.user.id));
}

export async function download(req, res) {
  const { report, filePath } = await reportService.downloadReport(req.params.reportId, req.user.id);
  const company = report.lead?.company || "website-audit";
  const safeCompany = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "website-audit";
  res.download(filePath, `${safeCompany}-audit-report${path.extname(filePath) || ".pdf"}`);
}
