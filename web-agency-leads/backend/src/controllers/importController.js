import * as importService from "../services/importService.js";
import { HttpError } from "../utils/httpError.js";

export async function upload(req, res) {
  if (!req.file) throw new HttpError(400, "Upload a CSV or XLSX file");
  res.status(201).json(await importService.importLeads(req.file, req.user.id));
}

export async function preview(req, res) {
  if (!req.file) throw new HttpError(400, "Upload a CSV or XLSX file");
  res.status(201).json(await importService.previewImport(req.file, req.user.id));
}

export async function updatePreview(req, res) {
  res.json(await importService.updatePreview(req.params.sessionId, req.body.mapping || {}));
}

export async function commit(req, res) {
  res.status(201).json(await importService.commitImport(req.params.sessionId, req.user.id, req.body));
}

export async function cancel(req, res) {
  res.json(await importService.cancelImport(req.params.sessionId, req.user.id));
}

export async function history(req, res) {
  res.json(await importService.listHistory(req.user.id));
}
