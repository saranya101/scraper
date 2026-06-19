import * as leadService from "../services/leadService.js";

export async function list(req, res) {
  res.json(await leadService.listLeads(req.query));
}

export async function get(req, res) {
  res.json(await leadService.getLead(req.params.id));
}

export async function create(req, res) {
  res.status(201).json(await leadService.createLead(req.body));
}

export async function update(req, res) {
  res.json(await leadService.updateLead(req.params.id, req.body, req.user.id));
}

export async function remove(req, res) {
  await leadService.deleteLead(req.params.id);
  res.status(204).send();
}
