import * as emailService from "../services/emailService.js";

export async function accounts(req, res) {
  res.json(await emailService.listAccounts(req.user.id));
}

export async function connectGoogle(req, res) {
  res.json(await emailService.connectUrl("GOOGLE", req.user.id));
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

export async function test(req, res) {
  res.status(201).json(await emailService.sendEmail(req.user.id, {
    leadId: req.body.leadId,
    toEmail: req.body.toEmail,
    subject: req.body.subject || "Ocia Studio Gmail API test",
    body: req.body.body || "This is a test email from the Ocia Studio lead dashboard using the Gmail API.",
    mode: "MANUAL_APPROVAL",
    testOnly: true,
    ignoreCooldown: true
  }));
}

export async function history(req, res) {
  res.json(await emailService.history(req.params.leadId, req.user.id));
}
