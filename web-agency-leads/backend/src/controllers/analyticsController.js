import * as analyticsService from "../services/analyticsService.js";

export async function overview(req, res) {
  res.json(await analyticsService.overview(req.query));
}

export async function industries(req, res) {
  res.json(await analyticsService.industries(req.query));
}

export async function services(req, res) {
  res.json(await analyticsService.services(req.query));
}

export async function locations(req, res) {
  res.json(await analyticsService.locations(req.query));
}

export async function funnel(req, res) {
  res.json(await analyticsService.funnel(req.query));
}
