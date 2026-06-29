import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { HttpError } from "../utils/httpError.js";

export const consultantKnowledgeVersion = process.env.CONSULTANT_KNOWLEDGE_VERSION || "v1";

const outputShape = {
  businessType: "",
  summary: "",
  primaryBusinessGoal: "",
  primaryCustomerGoal: "",
  customerJourney: [],
  decisionFactors: [],
  trustSignals: [],
  commonQuestions: [],
  commonObjections: [],
  highValuePages: [],
  criticalConversionPoints: [],
  expectedWebsiteFeatures: [],
  expectedTrustElements: [],
  expectedProofElements: [],
  expectedContentStructure: [],
  highImpactUXElements: [],
  seoPriorities: [],
  localBusinessSignals: [],
  competitiveDifferentiators: [],
  commonWebsiteMistakes: [],
  highImpactOpportunities: [],
  conversationStarters: [],
  observationPriorities: [],
  thingsOwnersAlreadyKnow: [],
  thingsOwnersProbablyDontKnow: []
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, 16);
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalizeBusinessType(value) {
  return slug(value || "business");
}

function normalizeIndustry(value) {
  return slug(value || "general");
}

export function knowledgeInputKey(input = {}) {
  const normalizedInput = validateInput(input);
  return [
    "consultantKnowledge",
    normalizeBusinessType(normalizedInput.businessType),
    normalizeIndustry(normalizedInput.industry),
    slug(normalizedInput.country || "global"),
    slug(normalizedInput.targetMarket || "all"),
    consultantKnowledgeVersion
  ].join(":");
}

function validateInput(input = {}) {
  const businessType = clean(input.businessType);
  const industry = clean(input.industry);
  if (!businessType && !industry) throw new HttpError(422, "Business type or industry is required");
  return {
    businessType: businessType || industry,
    industry: industry || businessType,
    country: clean(input.country),
    targetMarket: clean(input.targetMarket),
    normalizedBusinessType: normalizeBusinessType(businessType || industry),
    normalizedIndustry: normalizeIndustry(industry || businessType),
    normalizedCountry: slug(input.country || ""),
    normalizedMarket: slug(input.targetMarket || "")
  };
}

function normalizeModel(raw = {}, input = {}) {
  const normalized = Object.fromEntries(
    Object.entries(outputShape).map(([key, fallback]) => {
      if (Array.isArray(fallback)) return [key, normalizeArray(raw[key])];
      return [key, clean(raw[key])];
    })
  );
  return {
    ...normalized,
    businessType: normalized.businessType || input.businessType || input.industry,
    metadata: {
      modelVersion: consultantKnowledgeVersion,
      version: consultantKnowledgeVersion,
      industry: input.industry || "",
      country: input.country || "",
      targetMarket: input.targetMarket || "",
      generatedAt: new Date().toISOString()
    }
  };
}

function buildPrompt(input) {
  return `Build Phase 0 of Ocia Outreach Intelligence.

This phase runs before any website scan. Do not analyse a specific company or website. Do not generate emails. Do not recommend contacting anyone.

Input:
Business Type: ${input.businessType}
Industry: ${input.industry}
Country: ${input.country || "Not specified"}
Target Market: ${input.targetMarket || "Not specified"}

Goal:
Create a reusable consultant-level knowledge model for this type of business:
- how customers buy
- what customers care about
- what creates trust
- what creates friction
- what an exceptional website normally contains
- what usually causes lost enquiries
- what signals matter most

Think commercially, not technically. Conversation starters must be insight examples, not email templates.

Return strict JSON only with exactly these top-level fields:
${JSON.stringify(outputShape, null, 2)}

Rules:
- Be specific to this business type.
- Never analyse an actual website.
- Never assume a website is bad.
- Avoid generic marketing advice.
- Separate what owners already know from what they may not realise.
- CommonWebsiteMistakes and highImpactOpportunities should be commercially meaningful.
- ConversationStarters should sound like observations a sharp consultant might raise, not basic facts like phone/email/social links exist.`;
}

function fallbackModel(input) {
  return normalizeModel({
    businessType: input.businessType,
    summary: `${input.businessType} buyers usually need to understand the offer, trust the provider, compare options, and find a low-friction way to enquire.`,
    primaryBusinessGoal: "turn qualified interest into enquiries or bookings",
    primaryCustomerGoal: "find a trustworthy provider and understand the best next step",
    customerJourney: ["Search or referral", "Land on website", "Understand services", "Evaluate trust", "Compare alternatives", "Check contact or booking path", "Enquire"],
    decisionFactors: ["trust", "clarity", "proof", "convenience", "fit", "availability"],
    trustSignals: ["reviews", "testimonials", "credentials", "examples of work", "clear contact details"],
    commonQuestions: ["What do they offer?", "Can I trust them?", "Are they right for my situation?", "How do I take the next step?"],
    commonObjections: ["unclear pricing or process", "not enough proof", "too hard to enquire", "unclear fit"],
    highValuePages: ["homepage", "service pages", "proof or portfolio", "contact page", "FAQ"],
    criticalConversionPoints: ["hero section", "service detail pages", "proof sections", "contact or booking area"],
    expectedWebsiteFeatures: ["clear navigation", "service explanation", "proof", "contact path", "mobile-friendly pages"],
    expectedTrustElements: ["reviews", "testimonials", "credentials", "recognition"],
    expectedProofElements: ["case studies", "project examples", "outcomes", "client feedback"],
    expectedContentStructure: ["clear offer", "service detail", "proof", "questions answered", "next step"],
    highImpactUXElements: ["clear first screen", "simple navigation", "visible contact path", "mobile clarity"],
    seoPriorities: ["service intent pages", "local relevance", "clear titles and headings", "FAQ content"],
    localBusinessSignals: ["location", "phone", "address or service area", "reviews"],
    competitiveDifferentiators: ["specialisation", "proof quality", "speed of response", "customer experience"],
    commonWebsiteMistakes: ["hiding trust proof", "making the next step unclear", "thin service pages", "weak mobile journey"],
    highImpactOpportunities: ["bring proof closer to decision points", "make the enquiry journey clearer", "answer buying questions earlier"],
    conversationStarters: ["The site may explain the service, but the strongest proof needs to appear before visitors are asked to enquire."],
    observationPriorities: ["trust placement", "conversion path clarity", "service-page depth", "proof visibility"],
    thingsOwnersAlreadyKnow: ["they have contact details", "they have social profiles", "the website loads"],
    thingsOwnersProbablyDontKnow: ["which proof appears too late", "where visitors lose momentum", "which service pages may not answer buyer questions"]
  }, input);
}

async function callOpenAI(input) {
  if (!process.env.OPENAI_API_KEY) return fallbackModel(input);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You build reusable consultant knowledge models for Ocia Studio. Return strict JSON only. Never analyse a specific website or write emails." },
      { role: "user", content: buildPrompt(input) }
    ],
    temperature: 0.35
  });
  return normalizeModel(JSON.parse(response.choices[0]?.message?.content || "{}"), input);
}

export async function generateKnowledgeModel(userId, input = {}) {
  const normalizedInput = validateInput(input);
  const where = {
    normalizedBusinessType_normalizedIndustry_country_market_version: {
      normalizedBusinessType: normalizedInput.normalizedBusinessType,
      normalizedIndustry: normalizedInput.normalizedIndustry,
      country: normalizedInput.normalizedCountry,
      market: normalizedInput.normalizedMarket,
      version: consultantKnowledgeVersion
    }
  };
  const existing = await prisma.consultantKnowledgeModel.findUnique({ where });
  if (existing?.knowledgeJson && input.force !== true) {
    console.info("[consultant-knowledge-cache-hit]", {
      businessType: normalizedInput.normalizedBusinessType,
      industry: normalizedInput.normalizedIndustry,
      version: consultantKnowledgeVersion
    });
    console.info("[consultant-knowledge-reused-model]", { id: existing.id });
    return {
      ...existing.knowledgeJson,
      cacheId: existing.id,
      cacheStatus: "hit"
    };
  }

  console.info("[consultant-knowledge-cache-miss]", {
    businessType: normalizedInput.normalizedBusinessType,
    industry: normalizedInput.normalizedIndustry,
    version: consultantKnowledgeVersion,
    forced: input.force === true
  });

  const model = await callOpenAI(normalizedInput);
  const value = {
    ...model,
    input: normalizedInput,
    cacheKey: knowledgeInputKey(normalizedInput),
    version: consultantKnowledgeVersion
  };
  const saved = await prisma.consultantKnowledgeModel.upsert({
    where,
    create: {
      businessType: normalizedInput.businessType,
      normalizedBusinessType: normalizedInput.normalizedBusinessType,
      industry: normalizedInput.industry,
      normalizedIndustry: normalizedInput.normalizedIndustry,
      country: normalizedInput.normalizedCountry,
      market: normalizedInput.normalizedMarket,
      knowledgeJson: value,
      version: consultantKnowledgeVersion
    },
    update: {
      businessType: normalizedInput.businessType,
      industry: normalizedInput.industry,
      knowledgeJson: value
    }
  });
  console.info("[consultant-knowledge-generated-new-model]", { id: saved.id, version: consultantKnowledgeVersion });
  return {
    ...value,
    cacheId: saved.id,
    cacheStatus: "generated"
  };
}

export async function listKnowledgeModels() {
  const rows = await prisma.consultantKnowledgeModel.findMany({
    orderBy: { updatedAt: "desc" }
  });
  return rows.map((row) => ({
    key: row.id,
    updatedAt: row.updatedAt,
    model: {
      ...row.knowledgeJson,
      cacheId: row.id,
      version: row.version,
      businessType: row.businessType,
      industry: row.industry,
      input: {
        ...(row.knowledgeJson?.input || {}),
        businessType: row.businessType,
        industry: row.industry,
        country: row.country,
        targetMarket: row.market
      }
    }
  }));
}

export async function findKnowledgeModel(input = {}) {
  const normalizedInput = validateInput(input);
  const exact = await prisma.consultantKnowledgeModel.findUnique({
    where: {
      normalizedBusinessType_normalizedIndustry_country_market_version: {
        normalizedBusinessType: normalizedInput.normalizedBusinessType,
        normalizedIndustry: normalizedInput.normalizedIndustry,
        country: normalizedInput.normalizedCountry,
        market: normalizedInput.normalizedMarket,
        version: consultantKnowledgeVersion
      }
    }
  });
  if (exact?.knowledgeJson) {
    console.info("[consultant-knowledge-cache-hit]", {
      businessType: normalizedInput.normalizedBusinessType,
      industry: normalizedInput.normalizedIndustry,
      version: consultantKnowledgeVersion
    });
    console.info("[consultant-knowledge-reused-model]", { id: exact.id });
    return {
      ...exact.knowledgeJson,
      cacheId: exact.id,
      cacheStatus: "hit"
    };
  }

  console.info("[consultant-knowledge-cache-miss]", {
    businessType: normalizedInput.normalizedBusinessType,
    industry: normalizedInput.normalizedIndustry,
    version: consultantKnowledgeVersion
  });
  return null;
}
