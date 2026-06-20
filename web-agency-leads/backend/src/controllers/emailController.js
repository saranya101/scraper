import * as emailService from "../services/emailService.js";

export async function accounts(req, res) {
  res.json(await emailService.listAccounts(req.user.id));
}

export async function connectGoogle(req, res) {
  res.json(await emailService.connectUrl("GOOGLE", req.user.id));
}

export async function connectMicrosoft(req, res) {
  res.json(await emailService.connectUrl("MICROSOFT", req.user.id));
}

export async function callback(req, res) {
  const account = await emailService.completeOAuth(req.query);
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  res.redirect(`${clientUrl}/settings/email?connected=${encodeURIComponent(account.provider)}&email=${encodeURIComponent(account.email)}`);
}

export async function disconnect(req, res) {
  res.json(await emailService.disconnect(req.params.id, req.user.id));
}

export async function send(req, res) {
  res.status(201).json(await emailService.sendEmail(req.user.id, req.body));
}

export async function history(req, res) {
  res.json(await emailService.history(req.params.leadId, req.user.id));
}
