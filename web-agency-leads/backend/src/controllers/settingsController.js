import * as settingsService from "../services/settingsService.js";

export async function get(req, res) {
  res.json(await settingsService.getSettings(req.user.id));
}

export async function updateProfile(req, res) {
  res.json(await settingsService.updateProfile(req.user.id, req.body));
}

export async function updateApp(req, res) {
  res.json(await settingsService.updateAppSettings(req.user.id, req.body));
}

export async function createIndustry(req, res) {
  res.status(201).json(await settingsService.createIndustry(req.body));
}

export async function updateIndustry(req, res) {
  res.json(await settingsService.updateIndustry(req.params.id, req.body));
}

export async function deleteIndustry(req, res) {
  res.json(await settingsService.deleteIndustry(req.params.id));
}

export async function createService(req, res) {
  res.status(201).json(await settingsService.createService(req.body));
}

export async function updateService(req, res) {
  res.json(await settingsService.updateService(req.params.id, req.body));
}

export async function deleteService(req, res) {
  res.json(await settingsService.deleteService(req.params.id));
}
