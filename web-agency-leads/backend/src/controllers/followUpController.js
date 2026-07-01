import * as followUpService from "../services/followUpService.js";

export async function due(_req, res) {
  res.json(await followUpService.listDueFollowUps());
}

export async function generateDue(req, res) {
  res.json(await followUpService.generateDueFollowUpDrafts(req.user.id));
}

export async function generateBatch(req, res) {
  res.json(await followUpService.generateBatchFollowUpDrafts(req.user.id, req.body.leadIds));
}

export async function sendDue(req, res) {
  res.json(await followUpService.sendDueFollowUps(req.user.id));
}

export async function generate(req, res) {
  res.status(201).json(await followUpService.generateLeadFollowUpDraft(req.user.id, req.params.leadId));
}

export async function send(req, res) {
  res.status(201).json(await followUpService.sendLeadFollowUp(req.user.id, req.params.leadId, req.body || {}));
}
