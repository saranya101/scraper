import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";

const outreachTypes = ["EMAIL", "LINKEDIN_DM", "FOLLOW_UP_1", "FOLLOW_UP_2"];
const statuses = ["DRAFT", "SAVED", "COPIED", "SENT", "ARCHIVED"];

function labelType(type) {
  return {
    EMAIL: "Email",
    LINKEDIN_DM: "LinkedIn DM",
    FOLLOW_UP_1: "Follow-up 1",
    FOLLOW_UP_2: "Follow-up 2"
  }[type] || "Email";
}

function fallbackDraft(lead, type, tone) {
  const service = lead.serviceOpportunities?.[0];
  const serviceName = service?.service?.name || "website improvements";
  const issue = lead.issues?.[0]?.issueText || "a few conversion and trust opportunities on the site";
  const competitorStrengths = [
    ...new Set((lead.competitors || []).flatMap((competitor) => Array.isArray(competitor.strengths) ? competitor.strengths : []))
  ].slice(0, 2);
  const competitorAngle = competitorStrengths.length
    ? ` A few local competitors are already showing ${competitorStrengths.join(" and ").toLowerCase()}, which makes this a practical way to close the gap.`
    : "";
  const opener = `I was looking at ${lead.company}'s website and noticed ${issue}.`;
  const pitch = `We help ${lead.industry || "local businesses"} turn those gaps into clearer pages, stronger calls to action, and more qualified enquiries.${competitorAngle} Based on the audit, ${serviceName} looks like the strongest first move${service ? ` because ${service.reason}` : "."}`;
  const cta = type === "LINKEDIN_DM"
    ? "Worth a quick chat this week?"
    : "Would it be useful if I sent over 2-3 specific ideas for improving the site?";
  const subject = type === "EMAIL" ? `Quick idea for ${lead.company}` : null;
  return {
    subject,
    opener,
    pitch,
    cta,
    fullMessage: [subject ? `Subject: ${subject}` : null, opener, "", pitch, "", cta].filter((part) => part !== null).join("\n"),
    tone
  };
}

function buildPrompt({ lead, type, tone }) {
  const service = lead.serviceOpportunities?.[0];
  const issues = lead.issues?.map((issue) => issue.issueText).slice(0, 5).join("; ") || "No explicit issues saved.";
  const competitors = (lead.competitors || [])
    .slice(0, 3)
    .map((competitor) => {
      const strengths = Array.isArray(competitor.strengths) ? competitor.strengths.slice(0, 3).join(", ") : "Not audited yet";
      const weaknesses = Array.isArray(competitor.weaknesses) ? competitor.weaknesses.slice(0, 2).join(", ") : "None saved";
      return `${competitor.company} (${competitor.score}/10): strengths: ${strengths}; weaknesses: ${weaknesses}`;
    })
    .join("\n") || "No competitor comparison saved yet.";
  return `Create a personalized ${labelType(type)} outreach draft for a web agency.

Tone: ${tone || "consultative, concise, founder-led"}
Business: ${lead.company}
Website: ${lead.website}
Industry: ${lead.industry || "Unknown"}
Location: ${lead.location || lead.address || "Unknown"}
Audit score: ${lead.score}/10
Opportunity score: ${lead.opportunityScore || "Unknown"}/10
Website status: ${lead.websiteStatus}
Recommended service: ${service?.service?.name || "Website redesign"}
Service reason: ${service?.reason || "Use the audit issues to recommend the strongest first improvement."}
Estimated value: ${service ? `$${service.estimatedMinValue} - $${service.estimatedMaxValue}` : lead.estimatedProjectValue || "Unknown"}
Audit issues: ${issues}
Local competitor comparison:
${competitors}

Return strict JSON:
{
  "subject": "email subject or empty string for non-email",
  "opener": "personalized opener",
  "pitch": "short pitch tied to audit issue and recommended service",
  "cta": "low-friction CTA",
  "fullMessage": "complete ready-to-copy message"
}

Keep it natural, specific, and not spammy. If competitor data exists, use it as the sales angle without naming competitors directly unless it feels natural. Do not mention AI or automated scanning.`;
}

async function generateWithOpenAI(context) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(context.lead, context.type, context.tone);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You write concise, personalized B2B outreach for a premium web agency. Return only valid JSON." },
      { role: "user", content: buildPrompt(context) }
    ],
    temperature: 0.45
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  return {
    subject: parsed.subject || null,
    opener: parsed.opener || "",
    pitch: parsed.pitch || "",
    cta: parsed.cta || "",
    fullMessage: parsed.fullMessage || [parsed.opener, parsed.pitch, parsed.cta].filter(Boolean).join("\n\n"),
    tone: context.tone
  };
}

async function leadContext(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      issues: { orderBy: { createdAt: "asc" } },
      serviceOpportunities: {
        include: { service: true },
        orderBy: [{ recommended: "desc" }, { score: "desc" }]
      },
      competitors: { orderBy: { score: "desc" }, take: 3 }
    }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

export async function generateDraft(leadId, userId, input = {}) {
  const type = outreachTypes.includes(input.type) ? input.type : "EMAIL";
  const tone = input.tone || "consultative";
  const lead = await leadContext(leadId);
  const generated = await generateWithOpenAI({ lead, type, tone }).catch(() => fallbackDraft(lead, type, tone));

  const draft = await prisma.outreachDraft.create({
    data: {
      leadId,
      userId,
      type,
      subject: generated.subject || null,
      opener: generated.opener || "",
      pitch: generated.pitch || "",
      cta: generated.cta || "",
      fullMessage: generated.fullMessage || "",
      tone,
      status: "DRAFT"
    },
    include: { lead: true, user: { select: { id: true, name: true, email: true } } }
  });

  if (type === "EMAIL") {
    await prisma.lead.update({
      where: { id: leadId },
      data: { outreachEmail: draft.fullMessage, pipelineStage: "DRAFTED" }
    });
  }

  await prisma.leadNote.create({
    data: { leadId, userId, note: `Generated ${labelType(type)} outreach draft.` }
  });

  return draft;
}

export async function listDrafts(query = {}) {
  const leadFilters = {
    ...(query.industry ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
  const where = {
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(Object.keys(leadFilters).length ? { lead: leadFilters } : {})
  };
  return prisma.outreachDraft.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(Number(query.limit || 80), 1), 150),
    include: {
      lead: {
        include: {
          serviceOpportunities: {
            where: { recommended: true },
            include: { service: true },
            take: 1
          }
        }
      },
      user: { select: { id: true, name: true, email: true } }
    }
  });
}

export async function listLeadDrafts(leadId) {
  await leadContext(leadId);
  return listDrafts({ leadId, limit: 100 });
}

export async function updateDraft(id, input = {}) {
  const existing = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!existing) throw notFound("Outreach draft not found");
  const data = {
    ...(input.type && outreachTypes.includes(input.type) ? { type: input.type } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "subject") ? { subject: input.subject || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "opener") ? { opener: input.opener || "" } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "pitch") ? { pitch: input.pitch || "" } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "cta") ? { cta: input.cta || "" } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "fullMessage") ? { fullMessage: input.fullMessage || "" } : {}),
    ...(input.status && statuses.includes(input.status) ? { status: input.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "tone") ? { tone: input.tone || null } : {})
  };
  if (!Object.keys(data).length) throw new HttpError(422, "No draft changes provided");
  const draft = await prisma.outreachDraft.update({
    where: { id },
    data,
    include: { lead: true, user: { select: { id: true, name: true, email: true } } }
  });
  if (draft.type === "EMAIL" && draft.fullMessage) {
    await prisma.lead.update({ where: { id: draft.leadId }, data: { outreachEmail: draft.fullMessage } });
  }
  return draft;
}

export async function deleteDraft(id) {
  const existing = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!existing) throw notFound("Outreach draft not found");
  await prisma.outreachDraft.delete({ where: { id } });
}

export async function getQueue(query = {}) {
  const where = {
    ...(query.industry ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
  return prisma.lead.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(Number(query.limit || 50), 1), 100),
    include: {
      outreachDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
      serviceOpportunities: {
        where: { recommended: true },
        include: { service: true },
        take: 1
      }
    }
  });
}
