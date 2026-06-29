import * as businessUnderstandingService from "../services/businessUnderstandingService.js";

export async function fromInput(req, res) {
  res.json(await businessUnderstandingService.understandBusinessFromInput(req.body));
}

export async function fromLead(req, res) {
  res.json(await businessUnderstandingService.understandLeadBusiness(req.params.leadId, { persist: req.body?.persist !== false }));
}

export async function previewLeadInput(req, res) {
  res.json(await businessUnderstandingService.previewLeadBusinessInput(req.params.leadId));
}
