import * as automationService from "../services/automationService.js";

export async function schedules(req, res) {
  res.json(await automationService.listSchedules(req.user.id));
}

export async function createSchedule(req, res) {
  res.status(201).json(await automationService.createSchedule(req.body, req.user.id));
}

export async function updateSchedule(req, res) {
  res.json(await automationService.updateSchedule(req.params.id, req.body, req.user.id));
}

export async function removeSchedule(req, res) {
  await automationService.deleteSchedule(req.params.id);
  res.status(204).send();
}

export async function run(req, res) {
  res.status(202).json(await automationService.runSchedule(req.params.id, req.user.id));
}

export async function pause(req, res) {
  res.json(await automationService.pauseSchedule(req.params.id, req.user.id));
}

export async function finish(req, res) {
  res.json(await automationService.finishSchedule(req.params.id, req.user.id));
}

export async function dashboard(req, res) {
  res.json(await automationService.getDashboard(req.user.id));
}

export async function performance(req, res) {
  res.json(await automationService.getPerformance(req.user.id));
}

export async function diagnostics(req, res) {
  res.json(await automationService.getDiagnostics(req.user.id));
}

export async function runProgress(req, res) {
  res.json(await automationService.getRunProgress(req.params.id, req.user.id));
}

export async function notifications(req, res) {
  res.json(await automationService.listNotifications(req.user.id));
}

export async function readNotification(req, res) {
  res.json(await automationService.markNotificationRead(req.params.id, req.user.id));
}
