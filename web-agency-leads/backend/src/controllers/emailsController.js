import * as emailsService from "../services/emailsService.js";

export async function leads(req, res) {
  res.json(await emailsService.listQualifiedLeads(req.query));
}

export async function generate(req, res) {
  res.status(201).json(await emailsService.generateEmails(req.user.id, req.body));
}

export async function sendOne(req, res) {
  res.status(201).json(await emailsService.sendOne(req.user.id, req.body));
}

export async function sendBulkApproved(req, res) {
  res.status(201).json(await emailsService.sendBulkApproved(req.user.id, req.body));
}

export async function autoSend(req, res) {
  res.status(202).json(await emailsService.autoSend(req.user.id, req.body));
}

export async function bulkJob(req, res) {
  res.json(await emailsService.getBulkJob(req.params.id, req.user.id));
}

export async function cancelBulkJob(req, res) {
  res.json(await emailsService.cancelBulkJob(req.params.id, req.user.id));
}
