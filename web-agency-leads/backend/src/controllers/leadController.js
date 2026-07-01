import * as leadService from "../services/leadService.js";
import * as replyWorkflowService from "../services/replyWorkflowService.js";

export async function list(req, res) {
  res.json(await leadService.listLeads(req.query));
}

export async function replied(req, res) {
  res.json(await leadService.listRepliedLeads(req.query));
}

export async function needsAction(req, res) {
  res.json(await leadService.listNeedsActionLeads(req.query));
}

export async function pipeline(req, res) {
  res.json(await leadService.listPipeline(req.query));
}

export async function get(req, res) {
  res.json(await leadService.getLead(req.params.id));
}

export async function meta(_req, res) {
  res.json(await leadService.getMeta());
}

export async function create(req, res) {
  res.status(201).json(await leadService.createLead(req.body));
}

export async function update(req, res) {
  res.json(await leadService.updateLead(req.params.id, req.body, req.user.id));
}

export async function stage(req, res) {
  res.json(await leadService.updateStage(req.params.id, req.body.pipelineStage, req.user.id));
}

export async function assign(req, res) {
  res.json(await leadService.assignLead(req.params.id, req.body.assignedToUserId, req.user.id));
}

export async function reminder(req, res) {
  res.json(await leadService.setReminder(req.params.id, req.body.reminderDate, req.user.id));
}

export async function doNotContact(req, res) {
  res.json(await leadService.markDoNotContact(req.params.id, req.user.id, req.body));
}

export async function classifyReply(req, res) {
  res.json(await replyWorkflowService.classifyLeadReply(req.params.id, req.user.id));
}

export async function generateReplyDraft(req, res) {
  res.json(await replyWorkflowService.generateReplyDraft(req.params.id, req.user.id));
}

export async function bulkUpdate(req, res) {
  res.json(await leadService.bulkUpdate(req.body, req.user.id));
}

export async function bulkDelete(req, res) {
  res.json(await leadService.bulkDelete(req.body));
}

export async function deleteAll(req, res) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin access required" });
  res.json(await leadService.deleteAllLeads(req.body));
}

export async function remove(req, res) {
  await leadService.deleteLead(req.params.id);
  res.status(204).send();
}

export async function reprocessOpportunities(req, res) {
  res.json(await leadService.reprocessOpportunities(req.params.id));
}

export async function reprocessAllOpportunities(_req, res) {
  res.json(await leadService.reprocessAllOpportunities());
}
