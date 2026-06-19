import * as scannerService from "../services/scannerService.js";

export async function run(req, res) {
  res.status(201).json(await scannerService.runScan(req.body, req.user.id));
}

export async function history(_req, res) {
  res.json(await scannerService.getHistory());
}

export async function job(req, res) {
  res.json(await scannerService.getScanJob(req.params.id));
}

export async function results(req, res) {
  res.json(await scannerService.getResults(req.params.scanId, req.query));
}

export async function importSelected(req, res) {
  res.status(201).json(await scannerService.importResults(req.body.scanResultIds, req.user.id));
}

export async function templates(req, res) {
  res.json(await scannerService.listTemplates(req.user.id));
}

export async function createTemplate(req, res) {
  res.status(201).json(await scannerService.createTemplate(req.body, req.user.id));
}

export async function rerun(req, res) {
  res.status(201).json(await scannerService.rerun(req.params.scanId, req.user.id));
}

export async function retry(req, res) {
  res.status(202).json(await scannerService.retryFailedResult(req.params.id, req.user.id));
}
