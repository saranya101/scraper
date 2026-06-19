import * as outreachService from "../services/outreachService.js";

export async function generate(req, res) {
  res.status(201).json(await outreachService.generateDraft(req.params.leadId, req.user.id, req.body));
}

export async function list(req, res) {
  res.json(await outreachService.listDrafts(req.query));
}

export async function queue(req, res) {
  res.json(await outreachService.getQueue(req.query));
}

export async function byLead(req, res) {
  res.json(await outreachService.listLeadDrafts(req.params.leadId));
}

export async function update(req, res) {
  res.json(await outreachService.updateDraft(req.params.id, req.body));
}

export async function remove(req, res) {
  await outreachService.deleteDraft(req.params.id);
  res.status(204).send();
}
