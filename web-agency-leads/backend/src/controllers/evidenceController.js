import * as evidenceService from "../services/evidenceService.js";

export async function get(req, res) {
  res.json(await evidenceService.getEvidence(req.params.leadId, req.user.id));
}

export async function cheap(req, res) {
  res.json(await evidenceService.runCheapEvidenceScan(req.params.leadId));
}

export async function vision(req, res) {
  res.json(await evidenceService.runVisionEvidenceScan(req.params.leadId));
}

export async function correct(req, res) {
  res.status(201).json(await evidenceService.correctEvidence(req.params.leadId, req.user.id, req.body));
}
