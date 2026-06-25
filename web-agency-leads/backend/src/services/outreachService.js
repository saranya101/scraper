import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";

const outreachTypes = ["EMAIL", "LINKEDIN_DM", "COLD_CALL", "FOLLOW_UP_1", "FOLLOW_UP_2"];
const storedOutreachTypes = ["EMAIL", "LINKEDIN_DM", "FOLLOW_UP_1", "FOLLOW_UP_2"];
const statuses = ["DRAFT", "SAVED", "COPIED", "SENT", "ARCHIVED"];
const coldCallPrefix = "[Cold call]";

function labelType(type) {
  return {
    EMAIL: "Email",
    LINKEDIN_DM: "LinkedIn DM",
    COLD_CALL: "Cold call",
    FOLLOW_UP_1: "Follow-up 1",
    FOLLOW_UP_2: "Follow-up 2"
  }[type] || "Email";
}

const leadInclude = {
  industryRef: true,
  serviceOpportunities: {
    where: { recommended: true },
    include: { service: true },
    take: 1
  }
};

const outreachEvidenceMap = {
  bookingFormPresent: {
    observation: "I could not find a clear online booking or appointment path on the website",
    impact: "That can add friction for visitors who are ready to make an enquiry."
  },
  contactFormPresent: {
    observation: "I could not find a clear contact form on the website",
    impact: "That can make it harder for interested visitors to take the next step."
  },
  phoneVisible: {
    observation: "a phone number was not clearly visible on the pages reviewed",
    impact: "That can slow down enquiries from visitors who prefer to call."
  },
  emailVisible: {
    observation: "an email address was not clearly visible on the pages reviewed",
    impact: "That can make direct enquiries less convenient."
  },
  servicePagesPresent: {
    observation: "I could not find clear dedicated pages for the main services",
    impact: "That can make it harder for visitors and search engines to understand the full offer."
  },
  projectCaseStudyPagesPresent: {
    observation: "I could not find a clear portfolio, project, or case-study section",
    impact: "That can limit the proof visitors see before deciding to enquire."
  },
  basicSeoPresent: {
    observation: "some core search metadata or page-heading signals appear to be incomplete",
    impact: "That can reduce how clearly the site communicates its relevance in search."
  },
  pageSpeedUsable: {
    observation: "the site took longer than expected to load during the scan",
    impact: "Slower pages can cause potential customers to leave before enquiring."
  }
};

function verifiedOutreachObservation(lead) {
  const corrections = new Map((lead.evidenceCorrections || []).map((item) => [item.signalKey, item]));
  const signals = lead.scanEvidence?.signals || {};
  const machineEvidenceUsable = ["evidence_complete", "COMPLETED"].includes(lead.scanEvidence?.status);
  for (const [signalKey, copy] of Object.entries(outreachEvidenceMap)) {
    const correction = corrections.get(signalKey);
    if (correction) {
      if (correction.value === "absent") return { ...copy, source: "manual", evidence: correction.notes || "Manually reviewed." };
      continue;
    }
    if (!machineEvidenceUsable) continue;
    const signal = signals[signalKey];
    if (signal?.value === "absent" && Number(signal.confidence || 0) >= 0.82 && signal.evidence) {
      return { ...copy, source: signal.source, evidence: signal.evidence };
    }
  }
  return null;
}

function evidenceBackedEmailDraft(lead, tone) {
  const verified = verifiedOutreachObservation(lead);
  const opener = verified
    ? `I had a quick look at ${lead.company} and noticed ${verified.observation}.`
    : `I had a quick look at ${lead.company}.`;
  const pitch = verified ? `For example: ${verified.impact}` : "";
  const cta = "If useful, I can send over a few practical ideas for improving this.";
  return {
    subject: `Quick idea for ${lead.company}`,
    opener,
    pitch,
    cta,
    fullMessage: [
      "Hi there,",
      "",
      opener,
      ...(pitch ? ["", pitch] : []),
      "",
      cta,
      "",
      "Best,",
      "Ocia Studio"
    ].join("\n"),
    tone
  };
}

function fallbackDraft(lead, type, tone) {
  if (type === "EMAIL") return evidenceBackedEmailDraft(lead, tone);
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
  const isColdCall = type === "COLD_CALL";
  const cta = type === "LINKEDIN_DM"
    ? "Worth a quick chat this week?"
    : isColdCall
      ? "Would it be alright if I sent the quick notes over by email?"
      : "Would it be useful if I sent over 2-3 specific ideas for improving the site?";
  const subject = type === "EMAIL" ? `Quick idea for ${lead.company}` : null;
  if (isColdCall) {
    return {
      subject: null,
      opener: `Hi, is this the right person to speak with about ${lead.company}'s website?`,
      pitch: `I was reviewing local ${lead.industry || "business"} websites and noticed ${issue}. We help teams turn those gaps into clearer pages, stronger trust signals, and more enquiries. ${serviceName} looks like the strongest first move${service ? ` because ${service.reason}` : "."}`,
      cta,
      fullMessage: [
        `Hi, is this the right person to speak with about ${lead.company}'s website?`,
        "",
        `I was reviewing local ${lead.industry || "business"} websites and noticed ${issue}.`,
        "",
        `We help teams turn those gaps into clearer pages, stronger trust signals, and more enquiries. ${serviceName} looks like the strongest first move${service ? ` because ${service.reason}` : "."}`,
        "",
        cta
      ].join("\n"),
      tone
    };
  }
  return {
    subject,
    opener,
    pitch,
    cta,
    fullMessage: [subject ? `Subject: ${subject}` : null, opener, "", pitch, "", cta].filter((part) => part !== null).join("\n"),
    tone
  };
}

function normalizeGeneratedDraft(generated, lead, type, tone) {
  const fallback = fallbackDraft(lead, type, tone);
  const subject = type === "EMAIL" ? (generated.subject || fallback.subject || "") : "";
  const opener = generated.opener || fallback.opener || "";
  const pitch = generated.pitch || fallback.pitch || "";
  const cta = generated.cta || fallback.cta || "";
  const fullMessage = generated.fullMessage || fallback.fullMessage || [subject ? `Subject: ${subject}` : null, opener, "", pitch, "", cta].filter((part) => part !== null).join("\n");
  return {
    subject,
    opener,
    pitch,
    cta,
    fullMessage,
    tone
  };
}

function storageType(type) {
  if (storedOutreachTypes.includes(type)) return type;
  return "FOLLOW_UP_2";
}

function storageSubject(type, subject) {
  if (type !== "COLD_CALL") return subject || null;
  return subject ? `${coldCallPrefix} ${subject}` : coldCallPrefix;
}

function displayDraft(draft) {
  if (!draft) return draft;
  const isColdCall = draft.subject?.startsWith(coldCallPrefix);
  return {
    ...draft,
    type: isColdCall ? "COLD_CALL" : draft.type,
    subject: isColdCall ? draft.subject.replace(coldCallPrefix, "").trim() : draft.subject
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
  "subject": "email subject or empty string for non-email or cold call",
  "opener": "personalized opener",
  "pitch": "short pitch tied to audit issue and recommended service",
  "cta": "low-friction CTA",
  "fullMessage": "complete ready-to-copy message"
}

Keep it natural, specific, and not spammy. For cold calls, write a spoken call script with short sentences. If competitor data exists, use it as the sales angle without naming competitors directly unless it feels natural. Do not mention AI or automated scanning.`;
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
      evidenceCorrections: { orderBy: { updatedAt: "desc" } },
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
  const generated = type === "EMAIL"
    ? evidenceBackedEmailDraft(lead, tone)
    : normalizeGeneratedDraft(
        await generateWithOpenAI({ lead, type, tone }).catch(() => fallbackDraft(lead, type, tone)),
        lead,
        type,
        tone
      );

  const draft = await prisma.outreachDraft.create({
    data: {
      leadId,
      userId,
      type: storageType(type),
      subject: storageSubject(type, generated.subject),
      opener: generated.opener || "",
      pitch: generated.pitch || "",
      cta: generated.cta || "",
      fullMessage: generated.fullMessage || "",
      tone,
      status: "DRAFT"
    },
    include: { lead: { include: leadInclude }, user: { select: { id: true, name: true, email: true } } }
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

  return displayDraft(draft);
}

export async function listDrafts(query = {}) {
  const leadFilters = {
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.industry && !query.industryId ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
  const where = {
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.type === "COLD_CALL" ? { subject: { startsWith: coldCallPrefix } } : {}),
    ...(query.type && query.type !== "COLD_CALL" ? { type: query.type, NOT: { subject: { startsWith: coldCallPrefix } } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(Object.keys(leadFilters).length ? { lead: leadFilters } : {})
  };
  const drafts = await prisma.outreachDraft.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(Number(query.limit || 80), 1), 150),
    include: {
      lead: { include: leadInclude },
      user: { select: { id: true, name: true, email: true } }
    }
  });
  return drafts.map(displayDraft);
}

export async function listLeadDrafts(leadId) {
  await leadContext(leadId);
  return listDrafts({ leadId, limit: 100 });
}

export async function updateDraft(id, input = {}) {
  const existing = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!existing) throw notFound("Outreach draft not found");
  const data = {
    ...(input.type && outreachTypes.includes(input.type) ? { type: storageType(input.type) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "subject") || input.type === "COLD_CALL" ? { subject: storageSubject(input.type || existing.type, input.subject) } : {}),
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
    include: { lead: { include: leadInclude }, user: { select: { id: true, name: true, email: true } } }
  });
  if (draft.type === "EMAIL" && draft.fullMessage) {
    await prisma.lead.update({ where: { id: draft.leadId }, data: { outreachEmail: draft.fullMessage } });
  }
  if (data.status === "SENT") {
    await prisma.lead.update({ where: { id: draft.leadId }, data: { pipelineStage: "SENT", status: "CONTACTED" } });
  }
  return displayDraft(draft);
}

export async function deleteDraft(id) {
  const existing = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!existing) throw notFound("Outreach draft not found");
  await prisma.outreachDraft.delete({ where: { id } });
}

export async function getQueue(query = {}) {
  const where = {
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.industry && !query.industryId ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
  return prisma.lead.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(Number(query.limit || 50), 1), 100),
    include: {
      industryRef: true,
      outreachDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
      serviceOpportunities: {
        where: { recommended: true },
        include: { service: true },
        take: 1
      }
    }
  });
}
