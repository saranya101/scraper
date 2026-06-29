import crypto from "node:crypto";
import axios from "axios";
import jwt from "jsonwebtoken";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import * as resendService from "./resendService.js";

const providers = {
  GOOGLE: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    sendUrl: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
    env: {
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
      redirectUri: "GOOGLE_REDIRECT_URI"
    }
  }
};

function activeProvider() {
  return String(process.env.EMAIL_PROVIDER || "GMAIL").toUpperCase();
}

function allowedGoogleEmail() {
  const email = String(process.env.GOOGLE_OAUTH_ALLOWED_EMAIL || "").trim().toLowerCase();
  if (!email) throw new HttpError(500, "GOOGLE_OAUTH_ALLOWED_EMAIL is required for Gmail testing mode");
  return email;
}

function config(provider) {
  const item = providers[provider];
  if (!item) throw new HttpError(422, "Unsupported email provider");
  const clientId = process.env[item.env.clientId];
  const clientSecret = process.env[item.env.clientSecret];
  const redirectUri = process.env[item.env.redirectUri];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpError(400, "Google OAuth environment variables are missing");
  }
  return { ...item, clientId, clientSecret, redirectUri };
}

function encryptionKey() {
  const secret = process.env.EMAIL_TOKEN_ENCRYPTION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new HttpError(500, "EMAIL_TOKEN_ENCRYPTION_SECRET is required");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

function decrypt(value) {
  const [ivRaw, tagRaw, encryptedRaw] = String(value || "").split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
}

function stateToken(userId, provider) {
  return jwt.sign({ sub: userId, provider }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

function decodeState(state) {
  try {
    return jwt.verify(state, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(400, "Invalid or expired OAuth state");
  }
}

function publicAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    email: account.email,
    expiresAt: account.expiresAt,
    connectedAt: account.connectedAt,
    updatedAt: account.updatedAt,
    configured: true,
    active: activeProvider() === "GMAIL",
    testingMode: true,
    allowedEmail: allowedGoogleEmail()
  };
}

export async function listAccounts(userId) {
  void userId;
  if (activeProvider() === "RESEND") return [resendService.senderDetails()];
  const account = await prisma.emailAccount.findFirst({
    where: { provider: "GOOGLE", email: allowedGoogleEmail() },
    orderBy: { updatedAt: "desc" }
  });
  return account ? [publicAccount(account)] : [];
}

export async function connectUrl(provider, userId) {
  if (activeProvider() !== "GMAIL") throw new HttpError(409, "Gmail is not the active email provider");
  if (provider !== "GOOGLE") throw new HttpError(422, "Only Google OAuth is available in single-sender testing mode");
  const cfg = config(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state: stateToken(userId, provider)
  });
  if (provider === "GOOGLE") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return { authUrl: `${cfg.authUrl}?${params.toString()}` };
}

async function exchangeCode(provider, code) {
  const cfg = config(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code,
    grant_type: "authorization_code"
  });
  const { data } = await axios.post(cfg.tokenUrl, body, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
  return data;
}

async function refreshAccessToken(account) {
  const provider = account.provider;
  const cfg = config(provider);
  const refreshToken = decrypt(account.refreshTokenEncrypted);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const { data } = await axios.post(cfg.tokenUrl, body, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
  const refreshed = await prisma.emailAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encrypt(data.access_token),
      ...(data.refresh_token ? { refreshTokenEncrypted: encrypt(data.refresh_token) } : {}),
      expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : account.expiresAt
    }
  });
  return decrypt(refreshed.accessTokenEncrypted);
}

async function accessToken(account) {
  if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) return decrypt(account.accessTokenEncrypted);
  return refreshAccessToken(account);
}

async function connectedEmail(provider, tokenResponse) {
  const cfg = config(provider);
  const { data } = await axios.get(cfg.userInfoUrl, { headers: { Authorization: `Bearer ${tokenResponse.access_token}` }, timeout: 15000 });
  return data.email;
}

export async function completeOAuth({ code, state }) {
  if (!code || !state) throw new HttpError(400, "Missing OAuth code or state");
  const payload = decodeState(state);
  const provider = payload.provider;
  if (activeProvider() !== "GMAIL" || provider !== "GOOGLE") throw new HttpError(403, "Only Google OAuth is enabled");
  const tokenResponse = await exchangeCode(provider, code);
  if (!tokenResponse.access_token) throw new HttpError(400, "Google OAuth did not return an access token");
  const email = String(await connectedEmail(provider, tokenResponse) || "").toLowerCase();
  if (!email) throw new HttpError(400, "Could not read connected email address");
  if (email.toLowerCase() !== allowedGoogleEmail()) {
    throw new HttpError(403, `Only ${allowedGoogleEmail()} is allowed to connect and send`);
  }
  const existingAccount = await prisma.emailAccount.findUnique({
    where: { userId_provider_email: { userId: payload.sub, provider, email } }
  });
  if (!tokenResponse.refresh_token && !existingAccount?.refreshTokenEncrypted) {
    throw new HttpError(400, "Google did not return offline access. Remove the app from your Google account permissions, then reconnect.");
  }
  await prisma.emailAccount.deleteMany({
    where: {
      provider: "GOOGLE",
      OR: [{ email: { not: allowedGoogleEmail() } }, { userId: { not: payload.sub } }]
    }
  });
  const account = await prisma.emailAccount.upsert({
    where: { userId_provider_email: { userId: payload.sub, provider, email } },
    create: {
      userId: payload.sub,
      provider,
      email,
      accessTokenEncrypted: encrypt(tokenResponse.access_token),
      refreshTokenEncrypted: encrypt(tokenResponse.refresh_token),
      expiresAt: tokenResponse.expires_in ? new Date(Date.now() + Number(tokenResponse.expires_in) * 1000) : null
    },
    update: {
      accessTokenEncrypted: encrypt(tokenResponse.access_token),
      ...(tokenResponse.refresh_token ? { refreshTokenEncrypted: encrypt(tokenResponse.refresh_token) } : {}),
      expiresAt: tokenResponse.expires_in ? new Date(Date.now() + Number(tokenResponse.expires_in) * 1000) : null
    }
  });
  return publicAccount(account);
}

export async function disconnect(id, userId) {
  void userId;
  const account = await prisma.emailAccount.findFirst({ where: { id, provider: "GOOGLE", email: allowedGoogleEmail() } });
  if (!account) throw notFound("Email account not found");
  await prisma.emailAccount.delete({ where: { id } });
  return { disconnected: true };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailPrefix(email = "") {
  return String(email || "").split("@")[0] || "";
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanAwkwardCompanyPhrases(text = "", company = "") {
  let next = String(text || "");
  const name = String(company || "").trim();
  if (!name) return next;
  const escaped = escapeRegex(name);
  if (/^the\s+/i.test(name)) {
    next = next.replace(new RegExp(`\\bthe\\s+${escaped}\\b`, "gi"), name);
  }
  next = next.replace(new RegExp(`\\b(the\\s+){2,}${escaped}\\b`, "gi"), `the ${name}`);
  next = next.replace(new RegExp(`\\bin\\s+the\\s+${escaped}\\s+(space|industry|market)\\b`, "gi"), "");
  return next;
}

function normalizeWhitespace(body = "") {
  return String(body || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function senderFromInput(input = {}, user = {}, account = {}) {
  const email = input.fromEmail || user.senderEmail || account.email || user.email || "";
  const inputName = String(input.fromName || "").trim();
  const profileName = String(user.senderName || user.name || "").trim();
  const looksLikeEmailPrefix = inputName && emailPrefix(email) && inputName.toLowerCase() === emailPrefix(email).toLowerCase();
  return {
    name: String((looksLikeEmailPrefix ? profileName : inputName) || profileName || emailPrefix(email) || "").trim(),
    email: String(email || "").trim(),
    title: String(input.senderTitle || user.senderTitle || "").trim(),
    company: String(input.senderCompany || user.companyName || "").trim()
  };
}

function contactFirstName(input = {}, lead = {}) {
  return String(input.contactFirstName || lead.contactFirstName || lead.ownerName?.split?.(/\s+/)?.[0] || "").trim() || "there";
}

function signatureBlock(sender) {
  return ["Thanks,", sender.name, sender.title, sender.company].filter(Boolean).join("\n");
}

function normalizeSendBody({ body, lead, input, user, account }) {
  const sender = senderFromInput(input, user, account);
  const company = input.companyName || lead.company || "";
  let next = cleanAwkwardCompanyPhrases(normalizeWhitespace(body), company);
  next = next
    .replace(/^(Hi [^\n,]+,)\s+/i, "$1\n\n")
    .replace(/^(Hello [^\n,]+,)\s+/i, "$1\n\n")
    .replace(/\s+(Thanks,)/i, "\n\n$1");

  if (!/^(hi|hello)\s+/i.test(next)) {
    next = `Hi ${contactFirstName(input, lead)},\n\n${next}`;
  }

  const signature = signatureBlock(sender);
  if (signature) {
    const thanksPattern = /(?:\n\s*)?thanks,?[\s\S]*$/i;
    if (thanksPattern.test(next)) {
      next = next.replace(thanksPattern, `\n\n${signature}`);
    } else {
      next = `${next}\n\n${signature}`;
    }
  }

  return normalizeWhitespace(cleanAwkwardCompanyPhrases(next, company));
}

function textToEmailHtml(body = "") {
  const paragraphs = normalizeWhitespace(body)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return [
    '<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #111827;">',
    ...paragraphs.map((paragraph) => {
      const html = paragraph
        .split("\n")
        .map((line) => escapeHtml(line))
        .join("<br>");
      return `<p style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; margin: 0 0 14px 0;">${html}</p>`;
    }),
    "</div>"
  ].join("");
}

function makeGmailMessage({ from, toEmail, subject, text, html }) {
  const boundary = `ocia_${crypto.randomBytes(12).toString("hex")}`;
  const message = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

async function dailyLimit(userId) {
  const saved = await prisma.appSetting.findUnique({ where: { key: "emailSending" } });
  const limit = Number(saved?.value?.dailySendLimit || 25);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sentToday = await prisma.emailSend.count({ where: { userId, status: "SENT", sentAt: { gte: today } } });
  return { limit, sentToday, remaining: Math.max(0, limit - sentToday) };
}

async function cooldownDays() {
  const saved = await prisma.appSetting.findUnique({ where: { key: "emailSending" } });
  return Number(saved?.value?.cooldownDays || 14);
}

export async function getDailyLimit(userId) {
  return dailyLimit(userId);
}

export async function getCooldownDays() {
  return cooldownDays();
}

async function gmailAccount() {
  const account = await prisma.emailAccount.findFirst({
    where: { provider: "GOOGLE", email: allowedGoogleEmail() },
    orderBy: { updatedAt: "desc" }
  });
  if (!account) throw new HttpError(422, `Connect ${allowedGoogleEmail()} in Email Settings before sending`);
  return account;
}

async function providerSend({ account, toEmail, subject, body }) {
  const text = normalizeWhitespace(body);
  const html = textToEmailHtml(text);
  if (activeProvider() === "GMAIL") {
    const cfg = config("GOOGLE");
    await axios.post(
      cfg.sendUrl,
      { raw: makeGmailMessage({ from: account.email, toEmail, subject, text, html }) },
      { headers: { Authorization: `Bearer ${await accessToken(account)}` }, timeout: 30000 }
    );
    return { provider: "GMAIL", senderEmail: account.email };
  }
  await resendService.sendEmail({ to: toEmail, subject, html, text });
  return { provider: "RESEND", senderEmail: resendService.senderDetails().email };
}

export async function sendEmail(userId, input = {}) {
  const leadId = input.leadId;
  const toEmail = String(input.toEmail || "").trim();
  const subject = String(input.subject || "").trim();
  const rawBody = String(input.body || "").trim();
  if (!leadId) throw new HttpError(422, "Lead is required");
  if (!toEmail) throw new HttpError(422, "Recipient email is required");
  if (!subject) throw new HttpError(422, "Subject is required");
  if (!rawBody) throw new HttpError(422, "Email body is required");

  const [lead, draft, user] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    input.outreachDraftId ? prisma.outreachDraft.findUnique({ where: { id: input.outreachDraftId } }) : null,
    prisma.user.findUnique({ where: { id: userId } })
  ]);
  if (!lead) throw notFound("Lead not found");
  if (!user) throw notFound("User not found");
  if (input.outreachDraftId && (!draft || draft.leadId !== leadId)) throw notFound("Outreach draft not found");
  const cooldown = await cooldownDays();
  if (!input.ignoreCooldown && lead.lastEmailSentAt && Date.now() - lead.lastEmailSentAt.getTime() < cooldown * 24 * 60 * 60 * 1000) {
    throw new HttpError(409, `Lead was contacted recently. Cooldown is ${cooldown} days.`);
  }

  const limit = await dailyLimit(userId);
  if (limit.remaining <= 0) throw new HttpError(429, `Daily email send limit reached (${limit.limit})`);
  const provider = activeProvider();
  if (!["GMAIL", "RESEND"].includes(provider)) throw new HttpError(500, `Unsupported EMAIL_PROVIDER: ${provider}`);
  const account = provider === "GMAIL" ? await gmailAccount() : null;
  const body = normalizeSendBody({ body: rawBody, lead, input, user, account: account || {} });
  const sendRecord = await prisma.emailSend.create({
    data: {
      leadId,
      outreachDraftId: input.outreachDraftId || null,
      userId,
      emailAccountId: account?.id || null,
      toEmail,
      subject,
      body,
      provider,
      mode: input.mode || "MANUAL_APPROVAL",
      status: "PENDING"
    }
  });

  try {
    const delivery = await providerSend({ account, toEmail, subject, body });
    if (input.testOnly) {
      return prisma.emailSend.update({
        where: { id: sendRecord.id },
        data: { status: "SENT", mode: input.mode || "MANUAL_APPROVAL", sentAt: new Date() },
        include: { emailAccount: { select: { id: true, provider: true, email: true } } }
      });
    }
    const sent = await prisma.$transaction(async (tx) => {
      const updatedSend = await tx.emailSend.update({
        where: { id: sendRecord.id },
        data: { status: "SENT", sentAt: new Date() },
        include: {
          emailAccount: { select: { id: true, provider: true, email: true } }
        }
      });
      if (input.outreachDraftId) {
        await tx.outreachDraft.update({ where: { id: input.outreachDraftId }, data: { status: "SENT" } });
      }
      const current = await tx.lead.findUnique({ where: { id: leadId } });
      await tx.lead.update({
        where: { id: leadId },
        data: {
          pipelineStage: "SENT",
          status: "CONTACTED",
          emailStatus: "SENT",
          lastContactedAt: new Date(),
          lastEmailSentAt: new Date(),
          outreachEmail: body
        }
      });
      await tx.leadStatusHistory.create({
        data: {
          leadId,
          userId,
          oldStatus: current.status,
          newStatus: "CONTACTED",
          oldStage: current.pipelineStage,
          newStage: "SENT"
        }
      });
      await tx.leadNote.create({ data: { leadId, userId, note: `Sent email to ${toEmail} from ${delivery.senderEmail} via ${delivery.provider}.` } });
      return updatedSend;
    });
    return sent;
  } catch (error) {
    const failed = await prisma.emailSend.update({
      where: { id: sendRecord.id },
      data: { status: "FAILED", mode: input.mode || "MANUAL_APPROVAL", errorMessage: error.response?.data?.error?.message || error.message || "Email send failed" },
      include: {
        emailAccount: { select: { id: true, provider: true, email: true } }
      }
    });
    return failed;
  }
}

export async function history(leadId, userId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw notFound("Lead not found");
  const sends = await prisma.emailSend.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
      emailAccount: { select: { id: true, provider: true, email: true } },
      outreachDraft: { select: { id: true, type: true, status: true } }
    }
  });
  return {
    connectedAccounts: await listAccounts(userId),
    lastContactedAt: sends.find((send) => send.status === "SENT")?.sentAt || null,
    sends
  };
}
