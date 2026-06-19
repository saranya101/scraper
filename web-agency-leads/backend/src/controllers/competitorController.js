import * as competitorService from "../services/competitorService.js";

export async function find(req, res) {
  res.status(201).json(await competitorService.findCompetitors(req.params.leadId));
}

export async function list(req, res) {
  res.json(await competitorService.listCompetitors(req.params.leadId));
}

export async function audit(req, res) {
  res.status(202).json(await competitorService.auditCompetitors(req.params.leadId));
}
