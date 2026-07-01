import crypto from "node:crypto";
import fs from "node:fs/promises";
import axios from "axios";
import jwt from "jsonwebtoken";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import * as resendService from "./resendService.js";
import * as reportService from "./reportService.js";

const providers = {
  GOOGLE: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    sendUrl: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly"
    ],
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

export function activeEmailProvider() {
  return activeProvider();
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

export async function gmailAccessToken(account) {
  return accessToken(account);
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

function makeGmailMessage({ from, toEmail, subject, text, html, attachments = [], headers = [] }) {
  const mixedBoundary = `ocia_mixed_${crypto.randomBytes(12).toString("hex")}`;
  const altBoundary = `ocia_alt_${crypto.randomBytes(12).toString("hex")}`;
  const message = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    ...headers.filter(Boolean),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    ""
  ].join("\r\n");
  const attachmentParts = attachments.flatMap((attachment) => ([
    `--${mixedBoundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    attachment.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    ""
  ]));
  return Buffer.from([
    message,
    `--${altBoundary}--`,
    ...attachmentParts,
    `--${mixedBoundary}--`
  ].join("\r\n")).toString("base64url");
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

function websiteDomain(url = "") {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function ensureNoDuplicateOutreach({ lead, leadId, toEmail, eventType = "OUTBOUND", ignoreCooldown = false, allowDuplicate = false, testOnly = false }) {
  if (allowDuplicate || testOnly) return;
  if (lead.doNotContact) throw new HttpError(409, "Duplicate outreach blocked: lead is marked do not contact.");
  if (lead.bouncedAt || lead.emailStatus === "BOUNCED" || lead.pipelineStage === "BOUNCED") {
    throw new HttpError(409, "Duplicate outreach blocked: this lead previously bounced.");
  }
  if (eventType === "FOLLOW_UP_1" || eventType === "FOLLOW_UP_2") {
    const existingFollowUp = await prisma.emailSend.findFirst({
      where: { leadId, status: "SENT", eventType }
    });
    if (existingFollowUp) throw new HttpError(409, `Duplicate outreach blocked: ${eventType === "FOLLOW_UP_1" ? "follow-up 1" : "follow-up 2"} was already sent.`);
    return;
  }
  if (["SENT", "REPLIED", "BOUNCED"].includes(String(lead.emailStatus || "").toUpperCase())) {
    throw new HttpError(409, "Duplicate outreach blocked: this lead has already been contacted.");
  }
  const existingLeadSend = await prisma.emailSend.findFirst({
    where: { leadId, status: "SENT", eventType: "OUTBOUND" }
  });
  if (existingLeadSend) throw new HttpError(409, "Duplicate outreach blocked: this lead already has an initial outreach email.");
  const cooldown = await cooldownDays();
  const cutoff = new Date(Date.now() - cooldown * 24 * 60 * 60 * 1000);
  const existingRecipientSend = await prisma.emailSend.findFirst({
    where: {
      status: "SENT",
      eventType: "OUTBOUND",
      toEmail: { equals: toEmail, mode: "insensitive" },
      sentAt: ignoreCooldown ? undefined : { gte: cutoff }
    }
  });
  if (existingRecipientSend) {
    throw new HttpError(409, "Duplicate outreach blocked: same recipient was already contacted recently.");
  }
  const domain = websiteDomain(lead.website);
  if (!domain) return;
  const domainLead = await prisma.lead.findFirst({
    where: {
      id: { not: leadId },
      website: { contains: domain, mode: "insensitive" },
      emailSends: {
        some: {
          status: "SENT",
          eventType: "OUTBOUND",
          ...(ignoreCooldown ? {} : { sentAt: { gte: cutoff } })
        }
      }
    },
    select: { id: true, company: true }
  });
  if (domainLead) {
    throw new HttpError(409, `Duplicate outreach blocked: ${domainLead.company} on the same domain was already contacted recently.`);
  }
}

async function gmailAccount() {
  const account = await prisma.emailAccount.findFirst({
    where: { provider: "GOOGLE", email: allowedGoogleEmail() },
    orderBy: { updatedAt: "desc" }
  });
  if (!account) throw new HttpError(422, `Connect ${allowedGoogleEmail()} in Email Settings before sending`);
  return account;
}

export async function getActiveGmailAccount() {
  if (activeProvider() !== "GMAIL") throw new HttpError(409, "Gmail is not the active email provider");
  return gmailAccount();
}

export function gmailSenderEmail() {
  return allowedGoogleEmail();
}

async function providerSend({ account, toEmail, subject, body, attachments = [], gmailThreadId = null }) {
  const text = normalizeWhitespace(body);
  const html = textToEmailHtml(text);
  if (activeProvider() === "GMAIL") {
    const cfg = config("GOOGLE");
    const { data } = await axios.post(
      cfg.sendUrl,
      { raw: makeGmailMessage({ from: account.email, toEmail, subject, text, html, attachments }), ...(gmailThreadId ? { threadId: gmailThreadId } : {}) },
      { headers: { Authorization: `Bearer ${await accessToken(account)}` }, timeout: 30000 }
    );
    return {
      provider: "GMAIL",
      senderEmail: account.email,
      gmailMessageId: data?.id || null,
      gmailThreadId: data?.threadId || null
    };
  }
  await resendService.sendEmail({ to: toEmail, subject, html, text });
  return {
    provider: "RESEND",
    senderEmail: resendService.senderDetails().email,
    gmailMessageId: null,
    gmailThreadId: null
  };
}

async function resolveReportAttachment(userId, input = {}) {
  if (!input.includeReport) return null;
  const attachment = await reportService.resolveAttachmentForLead(input.leadId, userId, false);
  if (!attachment) throw new HttpError(422, "No approved report is available to attach.");
  const content = await fs.readFile(attachment.filePath);
  const maxBytes = Number(process.env.REPORT_ATTACHMENT_MAX_BYTES || 8 * 1024 * 1024);
  if (content.length > maxBytes) {
    throw new HttpError(422, "The report attachment is too large to send.");
  }
  return { ...attachment, content };
}

function naturalJoin(values = []) {
  const items = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function normalizedServiceIds(input = []) {
  return [...new Set((Array.isArray(input) ? input : []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean))].sort();
}

function sameServiceSelection(left = [], right = []) {
  const a = normalizedServiceIds(left);
  const b = normalizedServiceIds(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function appendReportMention(body, attachment) {
  if (!attachment) return body;
  if (/attached a short website opportunity report/i.test(body)) return body;
  const focusAreas = naturalJoin((attachment.selectedServices || []).map((item) => item.label).filter(Boolean).slice(0, 3));
  const sentence = focusAreas
    ? `I attached a short website opportunity report with a few specific improvements around ${focusAreas}.`
    : "I attached a short website opportunity report with a few specific suggestions.";
  return `${String(body || "").trim()}\n\n${sentence}`;
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
  await ensureNoDuplicateOutreach({
    lead,
    leadId,
    toEmail,
    eventType: input.eventType || "OUTBOUND",
    ignoreCooldown: input.ignoreCooldown,
    allowDuplicate: input.allowDuplicate,
    testOnly: input.testOnly
  });
  const scanEvidence = lead.scanEvidence && typeof lead.scanEvidence === "object" && !Array.isArray(lead.scanEvidence) ? lead.scanEvidence : {};
  const pipelineState = scanEvidence.outreachPipeline && typeof scanEvidence.outreachPipeline === "object" ? scanEvidence.outreachPipeline : {};
  const qualityGate = pipelineState.qualityGate && typeof pipelineState.qualityGate === "object" ? pipelineState.qualityGate : null;
  const selectedReportServices = Array.isArray(pipelineState.selectedReportServices) ? pipelineState.selectedReportServices : [];
  if (!input.skipPipelineQualityGate && !qualityGate?.approved) throw new HttpError(422, "Email quality gate has not been approved for this lead.");
  if (Array.isArray(input.emailSelectedServices) && input.emailSelectedServices.length && selectedReportServices.length && !sameServiceSelection(input.emailSelectedServices, selectedReportServices)) {
    throw new HttpError(422, "Email does not match the selected report services. Regenerate email before sending.");
  }
  const cooldown = await cooldownDays();
  if (!input.ignoreCooldown && lead.lastEmailSentAt && Date.now() - lead.lastEmailSentAt.getTime() < cooldown * 24 * 60 * 60 * 1000) {
    throw new HttpError(409, `Lead was contacted recently. Cooldown is ${cooldown} days.`);
  }

  const limit = await dailyLimit(userId);
  if (limit.remaining <= 0) throw new HttpError(429, `Daily email send limit reached (${limit.limit})`);
  const provider = activeProvider();
  if (!["GMAIL", "RESEND"].includes(provider)) throw new HttpError(500, `Unsupported EMAIL_PROVIDER: ${provider}`);
  const account = provider === "GMAIL" ? await gmailAccount() : null;
  const attachment = await resolveReportAttachment(userId, input);
  if (attachment && !sameServiceSelection(input.emailSelectedServices || [], attachment.selectedServices || [])) {
    throw new HttpError(422, "Email does not match selected PDF services. Regenerate email.");
  }
  const body = normalizeSendBody({ body: appendReportMention(rawBody, attachment), lead, input, user, account: account || {} });
  const sendRecord = await prisma.emailSend.create({
    data: {
      leadId,
      outreachDraftId: input.outreachDraftId || null,
      userId,
      emailAccountId: account?.id || null,
      auditReportId: attachment?.reportId || null,
      toEmail,
      subject,
      body,
      provider,
      mode: input.mode || "MANUAL_APPROVAL",
      status: "PENDING",
      eventType: input.eventType || "OUTBOUND"
    }
  });

  try {
    const delivery = await providerSend({
      account,
      toEmail,
      subject,
      body,
      attachments: attachment ? [attachment] : [],
      gmailThreadId: input.gmailThreadId || null
    });
    if (attachment?.reportId) await reportService.markReportAttached(attachment.reportId);
    const sentAt = new Date();
    if (input.testOnly) {
      return prisma.emailSend.update({
        where: { id: sendRecord.id },
        data: {
          status: "SENT",
          mode: input.mode || "MANUAL_APPROVAL",
          sentAt,
          gmailMessageId: delivery.gmailMessageId,
          gmailThreadId: delivery.gmailThreadId
        },
        include: { emailAccount: { select: { id: true, provider: true, email: true } } }
      });
    }
    const sent = await prisma.$transaction(async (tx) => {
      const updatedSend = await tx.emailSend.update({
        where: { id: sendRecord.id },
        data: {
          status: "SENT",
          sentAt,
          gmailMessageId: delivery.gmailMessageId,
          gmailThreadId: delivery.gmailThreadId
        },
        include: {
          emailAccount: { select: { id: true, provider: true, email: true } }
        }
      });
      if (input.outreachDraftId) {
        await tx.outreachDraft.update({ where: { id: input.outreachDraftId }, data: { status: "SENT" } });
      }
      const current = await tx.lead.findUnique({ where: { id: leadId } });
      const leadUpdate = {
        lastContactedAt: sentAt,
        lastEmailSentAt: sentAt,
        gmailMessageId: delivery.gmailMessageId,
        gmailThreadId: delivery.gmailThreadId,
        outreachEmail: body
      };
      if ((input.eventType || "OUTBOUND") === "OUTBOUND") {
        Object.assign(leadUpdate, {
          pipelineStage: "SENT",
          status: "CONTACTED",
          emailStatus: "SENT"
        });
      }
      await tx.lead.update({
        where: { id: leadId },
        data: leadUpdate
      });
      if ((input.eventType || "OUTBOUND") === "OUTBOUND") {
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
      }
      await tx.leadNote.create({
        data: {
          leadId,
          userId,
          note: `${input.eventType === "FOLLOW_UP_1" ? "Sent follow-up 1" : input.eventType === "FOLLOW_UP_2" ? "Sent follow-up 2" : "Sent email"} to ${toEmail} from ${delivery.senderEmail} via ${delivery.provider}.`
        }
      });
      return updatedSend;
    });
    if (!input.testOnly && (input.eventType || "OUTBOUND") === "OUTBOUND") {
      const { scheduleInitialFollowUp } = await import("./followUpService.js");
      await prisma.$transaction(async (tx) => {
        const currentLead = await tx.lead.findUnique({ where: { id: leadId } });
        if (currentLead) await scheduleInitialFollowUp(tx, currentLead, sentAt);
      });
    }
    if (attachment?.reportId) await reportService.markReportSent(attachment.reportId);
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
    orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }, { createdAt: "desc" }],
    include: {
      user: { select: { id: true, name: true, email: true } },
      emailAccount: { select: { id: true, provider: true, email: true } },
      outreachDraft: { select: { id: true, type: true, status: true } },
      auditReport: { select: { id: true, status: true, pdfUrl: true } }
    }
  });
  return {
    connectedAccounts: await listAccounts(userId),
    lastContactedAt: sends.find((send) => send.status === "SENT")?.sentAt || null,
    sends
  };
}
