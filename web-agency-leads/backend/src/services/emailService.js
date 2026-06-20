import crypto from "node:crypto";
import axios from "axios";
import jwt from "jsonwebtoken";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";

const providers = {
  GOOGLE: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    sendUrl: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send"],
    env: {
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
      redirectUri: "GOOGLE_REDIRECT_URI"
    }
  },
  MICROSOFT: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    sendUrl: "https://graph.microsoft.com/v1.0/me/sendMail",
    scopes: ["offline_access", "openid", "email", "profile", "User.Read", "Mail.Send"],
    env: {
      clientId: "MICROSOFT_CLIENT_ID",
      clientSecret: "MICROSOFT_CLIENT_SECRET",
      redirectUri: "MICROSOFT_REDIRECT_URI"
    }
  }
};

function config(provider) {
  const item = providers[provider];
  if (!item) throw new HttpError(422, "Unsupported email provider");
  const clientId = process.env[item.env.clientId];
  const clientSecret = process.env[item.env.clientSecret];
  const redirectUri = process.env[item.env.redirectUri];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpError(400, `${provider === "GOOGLE" ? "Google" : "Microsoft"} OAuth environment variables are missing`);
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
    updatedAt: account.updatedAt
  };
}

export async function listAccounts(userId) {
  const accounts = await prisma.emailAccount.findMany({
    where: { userId },
    orderBy: [{ connectedAt: "desc" }]
  });
  return accounts.map(publicAccount);
}

export async function connectUrl(provider, userId) {
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
  if (provider === "MICROSOFT") {
    params.set("prompt", "select_account");
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
  if (provider === "GOOGLE") {
    const { data } = await axios.get(cfg.userInfoUrl, { headers: { Authorization: `Bearer ${tokenResponse.access_token}` }, timeout: 15000 });
    return data.email;
  }
  const { data } = await axios.get(cfg.userInfoUrl, { headers: { Authorization: `Bearer ${tokenResponse.access_token}` }, timeout: 15000 });
  return data.mail || data.userPrincipalName;
}

export async function completeOAuth({ code, state }) {
  if (!code || !state) throw new HttpError(400, "Missing OAuth code or state");
  const payload = decodeState(state);
  const provider = payload.provider;
  const tokenResponse = await exchangeCode(provider, code);
  if (!tokenResponse.access_token || !tokenResponse.refresh_token) {
    throw new HttpError(400, "OAuth provider did not return the required tokens. Try reconnecting and accepting offline access.");
  }
  const email = await connectedEmail(provider, tokenResponse);
  if (!email) throw new HttpError(400, "Could not read connected email address");
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
      refreshTokenEncrypted: encrypt(tokenResponse.refresh_token),
      expiresAt: tokenResponse.expires_in ? new Date(Date.now() + Number(tokenResponse.expires_in) * 1000) : null
    }
  });
  return publicAccount(account);
}

export async function disconnect(id, userId) {
  const account = await prisma.emailAccount.findFirst({ where: { id, userId } });
  if (!account) throw notFound("Email account not found");
  await prisma.emailAccount.delete({ where: { id } });
  return { disconnected: true };
}

function makeRfcMessage({ from, toEmail, subject, body }) {
  const message = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\r\n");
  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function dailyLimit(userId) {
  const saved = await prisma.appSetting.findUnique({ where: { key: "emailSending" } });
  const limit = Number(saved?.value?.dailySendLimit || 25);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sentToday = await prisma.emailSend.count({ where: { userId, status: "SENT", sentAt: { gte: today } } });
  return { limit, sentToday, remaining: Math.max(0, limit - sentToday) };
}

async function providerSend({ account, token, toEmail, subject, body }) {
  if (account.provider === "GOOGLE") {
    await axios.post(
      providers.GOOGLE.sendUrl,
      { raw: makeRfcMessage({ from: account.email, toEmail, subject, body }) },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    return;
  }
  await axios.post(
    providers.MICROSOFT.sendUrl,
    {
      message: {
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: toEmail } }]
      },
      saveToSentItems: true
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
  );
}

export async function sendEmail(userId, input = {}) {
  const leadId = input.leadId;
  const toEmail = String(input.toEmail || "").trim();
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  if (!leadId) throw new HttpError(422, "Lead is required");
  if (!toEmail) throw new HttpError(422, "Recipient email is required");
  if (!subject) throw new HttpError(422, "Subject is required");
  if (!body) throw new HttpError(422, "Email body is required");

  const [lead, draft] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    input.outreachDraftId ? prisma.outreachDraft.findUnique({ where: { id: input.outreachDraftId } }) : null
  ]);
  if (!lead) throw notFound("Lead not found");
  if (input.outreachDraftId && (!draft || draft.leadId !== leadId)) throw notFound("Outreach draft not found");

  const account = input.emailAccountId
    ? await prisma.emailAccount.findFirst({ where: { id: input.emailAccountId, userId } })
    : await prisma.emailAccount.findFirst({ where: { userId }, orderBy: { connectedAt: "desc" } });
  if (!account) throw new HttpError(422, "Connect Gmail or Outlook before sending");

  const limit = await dailyLimit(userId);
  if (limit.remaining <= 0) throw new HttpError(429, `Daily email send limit reached (${limit.limit})`);

  const sendRecord = await prisma.emailSend.create({
    data: {
      leadId,
      outreachDraftId: input.outreachDraftId || null,
      userId,
      emailAccountId: account.id,
      toEmail,
      subject,
      body,
      status: "PENDING"
    }
  });

  try {
    await providerSend({ account, token: await accessToken(account), toEmail, subject, body });
    const sent = await prisma.$transaction(async (tx) => {
      const updatedSend = await tx.emailSend.update({
        where: { id: sendRecord.id },
        data: { status: "SENT", sentAt: new Date() },
        include: { emailAccount: { select: { id: true, provider: true, email: true } } }
      });
      if (input.outreachDraftId) {
        await tx.outreachDraft.update({ where: { id: input.outreachDraftId }, data: { status: "SENT" } });
      }
      const current = await tx.lead.findUnique({ where: { id: leadId } });
      await tx.lead.update({ where: { id: leadId }, data: { pipelineStage: "SENT", status: "CONTACTED", outreachEmail: body } });
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
      await tx.leadNote.create({ data: { leadId, userId, note: `Sent email to ${toEmail} from ${account.email}.` } });
      return updatedSend;
    });
    return sent;
  } catch (error) {
    const failed = await prisma.emailSend.update({
      where: { id: sendRecord.id },
      data: { status: "FAILED", errorMessage: error.response?.data?.error?.message || error.message || "Email send failed" },
      include: { emailAccount: { select: { id: true, provider: true, email: true } } }
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
