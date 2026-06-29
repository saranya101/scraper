import * as structuredEvidenceService from "../services/structuredEvidenceService.js";

export async function fromInput(req, res) {
  res.json(structuredEvidenceService.buildStructuredEvidence(req.body));
}

export async function fromLead(req, res) {
  res.json(await structuredEvidenceService.buildStructuredEvidenceForLead(req.params.leadId));
}

export async function fromScanResult(req, res) {
  res.json(await structuredEvidenceService.buildStructuredEvidenceForScanResult(req.params.scanResultId));
}
