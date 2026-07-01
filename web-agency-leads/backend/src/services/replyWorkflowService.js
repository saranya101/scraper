import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { notFound, HttpError } from "../utils/httpError.js";
import { classifyReply } from "./replyClassificationService.js";

function selectedServices(lead, report) {
  const fromReport = Array.isArray(report?.selectedServices) ? report.selectedServices : [];
  if (fromReport.length) return fromReport.map((item) => item.label || item.id).filter(Boolean);
  return (lead.serviceOpportunities || []).slice(0, 3).map((item) => item.service?.name || item.serviceId).filter(Boolean);
}

async function replyContext(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      industryRef: true,
      serviceOpportunities: {
        include: { service: true },
        orderBy: [{ recommended: "desc" }, { score: "desc" }]
      },
      auditReports: { orderBy: { createdAt: "desc" }, take: 1 },
      emailSends: {
        orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }, { createdAt: "desc" }],
        take: 20
      }
    }
  });
  if (!lead) throw notFound("Lead not found");
  const latestReply = (lead.emailSends || []).find((item) => item.eventType === "REPLY");
  if (!latestReply) throw new HttpError(404, "No synced reply found for this lead");
  const initialEmail = (lead.emailSends || []).find((item) => item.eventType === "OUTBOUND") || (lead.emailSends || []).find((item) => item.eventType !== "REPLY");
  return { lead, latestReply, initialEmail, report: lead.auditReports?.[0] || null };
}

export async function classifyLeadReply(leadId, userId) {
  const { lead, latestReply } = await replyContext(leadId);
  const classification = classifyReply({
    fromEmail: latestReply.fromEmail,
    subject: latestReply.subject,
    snippet: latestReply.snippet || latestReply.body
  });
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      replyClassification: classification.classification,
      replyClassificationConfidence: classification.confidence,
      suggestedNextAction: classification.suggestedNextAction,
      needsAction: classification.needsAction,
      needsActionReason: classification.needsActionReason,
      doNotContact: classification.shouldMarkDoNotContact ? true : lead.doNotContact,
      doNotContactReason: classification.shouldMarkDoNotContact ? "reply_unsubscribe" : lead.doNotContactReason,
      doNotContactAt: classification.shouldMarkDoNotContact ? new Date() : lead.doNotContactAt
    }
  });
  await prisma.leadNote.create({
    data: {
      leadId,
      userId,
      note: `Reply reclassified as ${classification.classification.toLowerCase().replaceAll("_", " ")}.`
    }
  });
  return {
    lead: updated,
    classification
  };
}

function fallbackReplyDraft({ lead, latestReply, initialEmail, report, classification }) {
  const firstName = String(lead.ownerName || "").trim().split(/\s+/)[0] || "there";
  const services = selectedServices(lead, report);
  const serviceLine = services.length ? `The main areas I noticed were around ${services.slice(0, 3).join(", ")}.` : "I can walk you through the main areas I noticed on the website.";
  const signoff = "\n\nThanks,\nArjun";
  switch (classification.classification) {
    case "INTERESTED":
      return `Hi ${firstName},\n\nThanks for getting back to me.\n\n${serviceLine} Would you be open to a quick 15-minute call this week? I can walk you through the report and show what I would improve first.${signoff}`;
    case "ASKED_FOR_PRICE":
      return `Hi ${firstName},\n\nThanks for getting back to me.\n\nIt depends on the scope, but for the kind of improvements I mentioned I would first suggest a short call so I can understand whether you need a small conversion fix, an enquiry automation flow, or a broader website improvement. After that I can give you a clearer estimate instead of guessing blindly.${signoff}`;
    case "ASKED_FOR_MORE_INFO":
      return `Hi ${firstName},\n\nThanks for getting back to me.\n\nHappy to share a bit more context. ${serviceLine} If useful, I can also send over the two or three changes I would prioritise first based on what I saw.${signoff}`;
    case "WRONG_CONTACT":
      return `Hi ${firstName},\n\nThanks for letting me know.\n\nNo problem at all. If there is someone else on the team who handles the website or enquiries, feel free to point me in the right direction.${signoff}`;
    case "NOT_INTERESTED":
      return `Hi ${firstName},\n\nNo worries, thanks for letting me know.\n\nI will not follow up further.${signoff}`;
    case "MAYBE_LATER":
      return `Hi ${firstName},\n\nThanks for the reply.\n\nNo problem at all. I will leave it here for now, and if it becomes a priority later on I am happy to pick the conversation back up.${signoff}`;
    default:
      return `Hi ${firstName},\n\nThanks for getting back to me.\n\n${serviceLine} If helpful, I can reply with a more concrete recommendation based on the part of the site you are most focused on right now.${signoff}`;
  }
}

export async function generateReplyDraft(leadId, userId) {
  const { lead, latestReply, initialEmail, report } = await replyContext(leadId);
  const classification = lead.replyClassification
    ? {
        classification: lead.replyClassification,
        suggestedNextAction: lead.suggestedNextAction || "",
        needsAction: lead.needsAction
      }
    : classifyReply({
        fromEmail: latestReply.fromEmail,
        subject: latestReply.subject,
        snippet: latestReply.snippet || latestReply.body
      });
  const fallback = fallbackReplyDraft({ lead, latestReply, initialEmail, report, classification });
  let body = fallback;
  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.45,
        messages: [
          { role: "system", content: "You write short, natural reply emails for a web agency founder. Return JSON only." },
          { role: "user", content: `Write a manual reply draft.

Lead: ${lead.company}
Industry: ${lead.industryRef?.name || lead.industry || "Unknown"}
Reply classification: ${classification.classification}
Selected services: ${selectedServices(lead, report).join(", ") || "General website improvements"}
Suggested next action: ${classification.suggestedNextAction || ""}
Original email:
${initialEmail?.body || ""}

Incoming reply:
${latestReply.snippet || latestReply.body || ""}

Rules:
- Keep it concise and human.
- Match the reply classification.
- Do not sound pushy.
- If the reply indicates unsubscribe/remove, confirm no further follow-up.

Return:
{ "body": "" }` }
        ]
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
      if (parsed.body) body = String(parsed.body).trim();
    } catch {
      body = fallback;
    }
  }
  await prisma.leadNote.create({
    data: {
      leadId,
      userId,
      note: "Manual reply draft generated."
    }
  });
  return {
    leadId,
    classification: classification.classification,
    suggestedNextAction: classification.suggestedNextAction || lead.suggestedNextAction || "",
    body
  };
}
