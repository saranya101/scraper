import * as importService from "../services/importService.js";
import { HttpError } from "../utils/httpError.js";

export async function upload(req, res) {
  if (!req.file) throw new HttpError(400, "Upload a CSV or XLSX file");
  res.status(201).json(await importService.importLeads(req.file, req.user.id));
}
