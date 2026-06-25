import { Resend } from "resend";
import { HttpError } from "../utils/httpError.js";

let warnedMissingReplyTo = false;

function configuration() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Ocia Studio <hello@ocia.studio>";
  const replyTo = String(process.env.EMAIL_REPLY_TO || "").trim();
  if (!apiKey) throw new HttpError(503, "RESEND_API_KEY is required before sending email");
  if (!replyTo && !warnedMissingReplyTo) {
    console.warn("[email] EMAIL_REPLY_TO is missing. Replies will default to the sender address.");
    warnedMissingReplyTo = true;
  }
  return { apiKey, from, replyTo };
}

export function senderDetails() {
  const from = process.env.EMAIL_FROM || "Ocia Studio <hello@ocia.studio>";
  const replyTo = String(process.env.EMAIL_REPLY_TO || "").trim();
  const email = from.match(/<([^>]+)>/)?.[1] || from;
  return {
    id: "resend",
    provider: "RESEND",
    email,
    from,
    replyTo: replyTo || null,
    configured: Boolean(process.env.RESEND_API_KEY),
    replyToConfigured: Boolean(replyTo)
  };
}

export async function sendEmail({ to, subject, html, text }) {
  const { apiKey, from, replyTo } = configuration();
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    ...(replyTo ? { replyTo } : {}),
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text
  });
  if (error) {
    const message = error.message || "Resend rejected the email";
    const sendError = new Error(message);
    sendError.code = error.name || "RESEND_ERROR";
    throw sendError;
  }
  return data;
}
