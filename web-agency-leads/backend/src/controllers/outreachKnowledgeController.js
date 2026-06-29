import * as outreachKnowledgeService from "../services/outreachKnowledgeService.js";

export async function generate(req, res) {
  res.status(201).json(await outreachKnowledgeService.generateKnowledgeModel(req.user.id, req.body));
}

export async function list(_req, res) {
  res.json(await outreachKnowledgeService.listKnowledgeModels());
}

export async function find(req, res) {
  res.json(await outreachKnowledgeService.findKnowledgeModel(req.query));
}
