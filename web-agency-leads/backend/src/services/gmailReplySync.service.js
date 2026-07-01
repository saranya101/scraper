import axios from "axios";
import pLimit from "p-limit";
import { prisma } from "../repositories/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { activeEmailProvider, getActiveGmailAccount, gmailAccessToken } from "./emailService.js";
import { stopFollowUps } from "./followUpService.js";
import { classifyReply, detectBounce } from "./replyClassificationService.js";

const gmailApiBase = "https://gmail.googleapis.com/gmail/v1/users/me";
const replySyncConcurrency = Number(process.env.GMAIL_REPLY_SYNC_CONCURRENCY || 6);

function lower(value = "") {
  return String(value || "").trim().toLowerCase();
}

function stageRank(stage = "") {
  return ["NOT_CONTACTED", "DRAFTED", "SENT", "REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].indexOf(stage);
}

function nextStageForReply(stage = "") {
  return stageRank(stage) > stageRank("REPLIED") ? stage : "REPLIED";
}

function nextStatusForStage(stage = "") {
  if (stage === "NOT_CONTACTED" || stage === "DRAFTED") return "NOT_CONTACTED";
  if (stage === "REPLIED" || stage === "MEETING" || stage === "PROPOSAL") return "REPLIED";
  if (stage === "WON" || stage === "LOST") return "CLOSED";
  return "CONTACTED";
}

function parseEmailAddress(value = "") {
  const match = String(value || "").match(/<([^>]+)>/);
  return lower(match?.[1] || value);
}

function headerMap(headers = []) {
  return Object.fromEntries((headers || []).map((header) => [String(header.name || "").toLowerCase(), String(header.value || "")]));
}

function messageDate(message = {}) {
  const internal = Number(message.internalDate || 0);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal);
  const headers = headerMap(message.payload?.headers);
  const parsed = Date.parse(headers.date || "");
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

function messageSubject(message = {}) {
  return headerMap(message.payload?.headers).subject || "Reply received";
}

function isAutoReply(message = {}) {
  const headers = headerMap(message.payload?.headers);
  const autoSubmitted = lower(headers["auto-submitted"]);
  const precedence = lower(headers.precedence);
  const xAutoreply = lower(headers["x-autoreply"]);
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (xAutoreply) return true;
  if (["bulk", "auto_reply", "junk", "list"].includes(precedence)) return true;
  return false;
}

function gmailSearchDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function replySnippet(message = {}) {
  return String(message.snippet || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

async function gmailGet(accessToken, path, params = {}) {
  try {
    const { data } = await axios.get(`${gmailApiBase}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
      timeout: 30000
    });
    return data;
  } catch (error) {
    const gmailError = error.response?.data?.error;
    const reason = gmailError?.status || gmailError?.message || error.message || "Gmail request failed";
    if (error.response?.status === 401) {
      throw new HttpError(401, "Gmail access expired. Reconnect the Gmail account in Email Settings and try again.");
    }
    if (error.response?.status === 403) {
      throw new HttpError(403, "Gmail reply sync needs inbox read access. Reconnect the Gmail account to grant Gmail read permissions, then try Sync Replies again.");
    }
    throw new HttpError(502, `Gmail API request failed: ${reason}`);
  }
}

async function listRecentMessages(accessToken, afterDate, maxMessages) {
  const messages = [];
  let pageToken = undefined;
  const maxResults = Math.min(Math.max(Number(maxMessages || 100), 1), 500);
  do {
    const data = await gmailGet(accessToken, "/messages", {
      q: `in:anywhere after:${gmailSearchDate(afterDate)}`,
      maxResults: Math.min(maxResults - messages.length, 100),
      pageToken
    });
    messages.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && messages.length < maxResults);
  return messages.slice(0, maxResults);
}

function candidateBuckets(leads = []) {
  const threadMap = new Map();
  const recipientMap = new Map();
  let oldestSentAt = null;

  for (const lead of leads) {
    const sends = (lead.emailSends || [])
      .filter((send) => send.provider === "GMAIL" && send.eventType !== "REPLY" && send.status === "SENT" && send.sentAt)
      .sort((left, right) => new Date(right.sentAt) - new Date(left.sentAt));
    for (const send of sends) {
      const recipient = lower(send.toEmail);
      if (!recipient) continue;
      const candidate = {
        leadId: lead.id,
        leadName: lead.company,
        leadStatus: lead.status,
        pipelineStage: lead.pipelineStage,
        emailStatus: lead.emailStatus,
        repliedAt: lead.repliedAt,
        recipient,
        toEmail: send.toEmail,
        sentAt: new Date(send.sentAt),
        gmailMessageId: send.gmailMessageId || lead.gmailMessageId || null,
        gmailThreadId: send.gmailThreadId || lead.gmailThreadId || null,
        userId: send.userId,
        outreachDraftId: send.outreachDraftId || null,
        emailAccountId: send.emailAccountId || null
      };
      if (!oldestSentAt || candidate.sentAt < oldestSentAt) oldestSentAt = candidate.sentAt;
      if (candidate.gmailThreadId) {
        const current = threadMap.get(candidate.gmailThreadId) || [];
        current.push(candidate);
        threadMap.set(candidate.gmailThreadId, current);
      }
      const currentRecipient = recipientMap.get(recipient) || [];
      currentRecipient.push(candidate);
      recipientMap.set(recipient, currentRecipient);
    }
  }

  for (const entries of threadMap.values()) entries.sort((left, right) => right.sentAt - left.sentAt);
  for (const entries of recipientMap.values()) entries.sort((left, right) => right.sentAt - left.sentAt);

  return { threadMap, recipientMap, oldestSentAt };
}

function resolveMatch(message, threadMap, recipientMap) {
  const fromEmail = parseEmailAddress(headerMap(message.payload?.headers).from || "");
  const receivedAt = messageDate(message);
  const threadCandidates = message.threadId ? (threadMap.get(message.threadId) || []) : [];
  const threadMatch = threadCandidates.find((candidate) => receivedAt > candidate.sentAt && message.id !== candidate.gmailMessageId);
  if (threadMatch) return { match: threadMatch, method: "thread", fromEmail, receivedAt };

  const fallbackCandidates = recipientMap.get(fromEmail) || [];
  const fallbackMatch = fallbackCandidates.find((candidate) => !candidate.repliedAt && lower(candidate.emailStatus) !== "replied" && receivedAt > candidate.sentAt);
  if (fallbackMatch) return { match: fallbackMatch, method: "sender_email", fromEmail, receivedAt };

  return { match: null, method: null, fromEmail, receivedAt };
}

async function persistReply({ message, match, fromEmail, receivedAt, accountEmail, method, autoReply = false }) {
  const snippet = replySnippet(message);
  const subject = messageSubject(message);
  const bounce = detectBounce({ fromEmail, subject, snippet });
  const classification = classifyReply({ fromEmail, subject, snippet, isAutoReply: autoReply });
  const lead = await prisma.lead.findUnique({
    where: { id: match.leadId },
    select: {
      id: true,
      company: true,
      status: true,
      pipelineStage: true,
      repliedAt: true,
      gmailThreadId: true,
      lastReplySnippet: true,
      lastReplyFrom: true,
      lastReplyMessageId: true,
      emailStatus: true,
      doNotContact: true,
      doNotContactReason: true
    }
  });
  if (!lead) return { updated: false };

  const replyStage = bounce.bounced ? "BOUNCED" : nextStageForReply(lead.pipelineStage);
  const replyStatus = bounce.bounced ? "CONTACTED" : nextStatusForStage(replyStage);
  const firstReplyAt = lead.repliedAt && new Date(lead.repliedAt) < receivedAt ? lead.repliedAt : receivedAt;
  const shouldWriteHistory = lead.pipelineStage !== replyStage || lead.status !== replyStatus;
  const note = bounce.bounced
    ? `Bounce detected from ${fromEmail || "unknown sender"} via Gmail ${method === "thread" ? "thread match" : "sender fallback"}${snippet ? `: ${snippet}` : "."}`
    : autoReply
      ? `Auto-reply detected from ${fromEmail || "unknown sender"}${snippet ? `: ${snippet}` : "."}`
      : `Reply detected from ${fromEmail || "unknown sender"} via Gmail ${method === "thread" ? "thread match" : "sender fallback"}${snippet ? `: ${snippet}` : "."}`;

  await prisma.$transaction(async (tx) => {
    await tx.emailSend.create({
      data: {
        leadId: lead.id,
        outreachDraftId: match.outreachDraftId,
        userId: match.userId,
        emailAccountId: match.emailAccountId,
        toEmail: match.toEmail,
        subject,
        body: snippet || "(No snippet available)",
        provider: "GMAIL",
        mode: "MANUAL_APPROVAL",
        status: "SENT",
        eventType: "REPLY",
        receivedAt,
        fromEmail,
        snippet,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId || lead.gmailThreadId || match.gmailThreadId || null
      }
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        emailStatus: bounce.bounced ? "BOUNCED" : "REPLIED",
        pipelineStage: replyStage,
        status: replyStatus,
        repliedAt: firstReplyAt,
        lastReplySnippet: snippet || lead.lastReplySnippet,
        lastReplyFrom: fromEmail || lead.lastReplyFrom,
        lastReplyMessageId: message.id || lead.lastReplyMessageId,
        gmailThreadId: message.threadId || lead.gmailThreadId || match.gmailThreadId || null,
        replyClassification: bounce.bounced ? "OTHER" : classification.classification,
        replyClassificationConfidence: bounce.bounced ? 1 : classification.confidence,
        suggestedNextAction: bounce.bounced ? "Do not send more emails to this address." : classification.suggestedNextAction,
        needsAction: bounce.bounced ? false : classification.needsAction,
        needsActionReason: bounce.bounced ? null : classification.needsActionReason,
        doNotContact: classification.shouldMarkDoNotContact ? true : lead.doNotContact,
        doNotContactReason: classification.shouldMarkDoNotContact ? "reply_unsubscribe" : lead.doNotContactReason,
        doNotContactAt: classification.shouldMarkDoNotContact ? receivedAt : undefined,
        bouncedAt: bounce.bounced ? receivedAt : undefined,
        bounceReason: bounce.bounced ? bounce.reason : undefined
      }
    });
    await stopFollowUps(tx, lead.id, bounce.bounced ? "bounced" : "reply_detected");

    if (shouldWriteHistory) {
      await tx.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          userId: match.userId,
          oldStatus: lead.status,
          newStatus: replyStatus,
          oldStage: lead.pipelineStage,
          newStage: replyStage
        }
      });
    }

    await tx.leadNote.create({
      data: {
        leadId: lead.id,
        userId: match.userId,
        note
      }
    });
    await tx.leadNote.create({
      data: {
        leadId: lead.id,
        userId: match.userId,
        note: bounce.bounced
          ? "Reply classified as bounce."
          : `Reply classified as ${classification.classification.toLowerCase().replaceAll("_", " ")}${classification.needsActionReason ? ` · needs action: ${classification.needsActionReason.replaceAll("_", " ")}` : "."}`
      }
    });
  });

  console.info(`Matched reply for lead: ${lead.company}`);
  return { updated: true };
}

export async function syncGmailReplies({ maxMessages, lookbackDays, initiatedByUserId, source = "manual" } = {}) {
  if (activeEmailProvider() !== "GMAIL") {
    throw new Error("Gmail reply sync is only available when Gmail is the active email provider.");
  }

  console.info(`Starting Gmail reply sync (${source})`);
  const account = await getActiveGmailAccount();
  const accessToken = await gmailAccessToken(account);
  const leads = await prisma.lead.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [
        { lastEmailSentAt: { not: null } },
        { gmailThreadId: { not: null } },
        { pipelineStage: { in: ["SENT", "REPLIED", "BOUNCED", "MEETING", "PROPOSAL", "WON", "LOST"] } },
        { emailSends: { some: { provider: "GMAIL", status: "SENT" } } }
      ]
    },
    select: {
      id: true,
      company: true,
      status: true,
      pipelineStage: true,
      emailStatus: true,
      repliedAt: true,
      ownerEmail: true,
      generalEmail: true,
      gmailMessageId: true,
      gmailThreadId: true,
      emailSends: {
        where: { status: "SENT", eventType: { in: ["OUTBOUND", "FOLLOW_UP_1", "FOLLOW_UP_2"] } },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          toEmail: true,
          sentAt: true,
          gmailMessageId: true,
          gmailThreadId: true,
          userId: true,
          outreachDraftId: true,
          emailAccountId: true,
          provider: true,
          eventType: true,
          status: true
        }
      }
    }
  });

  const { threadMap, recipientMap, oldestSentAt } = candidateBuckets(leads);
  if (!oldestSentAt) {
    return { scannedThreads: 0, repliesFound: 0, leadsUpdated: 0, skippedOwnMessages: 0, errors: [] };
  }

  const lookbackFloor = new Date(Date.now() - Number(lookbackDays || process.env.GMAIL_REPLY_SYNC_LOOKBACK_DAYS || 30) * 24 * 60 * 60 * 1000);
  const afterDate = oldestSentAt > lookbackFloor ? new Date(oldestSentAt.getTime() - 24 * 60 * 60 * 1000) : lookbackFloor;
  const messageRefs = await listRecentMessages(accessToken, afterDate, Number(maxMessages || process.env.GMAIL_REPLY_SYNC_MAX_MESSAGES || 100));
  console.info(`Fetched ${messageRefs.length} recent Gmail messages`);
  const scannedThreads = new Set(messageRefs.map((item) => item.threadId).filter(Boolean)).size;

  const limit = pLimit(replySyncConcurrency);
  const messages = await Promise.all(
    messageRefs.map((item) =>
      limit(() =>
        gmailGet(accessToken, `/messages/${item.id}`, {
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date", "Auto-Submitted", "Precedence", "X-Autoreply"]
        })
      )
    )
  );

  const existing = await prisma.emailSend.findMany({
    where: {
      gmailMessageId: {
        in: messages.map((message) => message.id).filter(Boolean)
      }
    },
    select: { gmailMessageId: true }
  });
  const existingMessageIds = new Set(existing.map((item) => item.gmailMessageId).filter(Boolean));

  let repliesFound = 0;
  let leadsUpdated = 0;
  let skippedOwnMessages = 0;
  const errors = [];

  for (const message of messages.sort((left, right) => messageDate(left) - messageDate(right))) {
    try {
      if (existingMessageIds.has(message.id)) continue;
      const headers = headerMap(message.payload?.headers);
      const fromEmail = parseEmailAddress(headers.from || "");
      if (!fromEmail) continue;
      if (lower(fromEmail) === lower(account.email) || (message.labelIds || []).includes("SENT")) {
        skippedOwnMessages += 1;
        console.info("Skipped own message");
        continue;
      }
      const autoReply = isAutoReply(message);
      const resolved = resolveMatch(message, threadMap, recipientMap);
      if (!resolved.match) {
        console.info("No matching lead found");
        continue;
      }
      if (resolved.receivedAt <= resolved.match.sentAt) {
        console.info("Skipped old message before sentAt");
        continue;
      }
      if (message.id === resolved.match.gmailMessageId || lower(fromEmail) === lower(account.email)) {
        skippedOwnMessages += 1;
        console.info("Skipped own message");
        continue;
      }
      repliesFound += 1;
      const result = await persistReply({
        message,
        match: resolved.match,
        fromEmail: resolved.fromEmail,
        receivedAt: resolved.receivedAt,
        accountEmail: account.email,
        method: resolved.method,
        autoReply
      });
      if (result.updated) leadsUpdated += 1;
    } catch (error) {
      errors.push(error.message || "Reply sync failed for one message");
    }
  }

  console.info("Reply sync complete");
  return { scannedThreads, repliesFound, leadsUpdated, skippedOwnMessages, errors };
}
