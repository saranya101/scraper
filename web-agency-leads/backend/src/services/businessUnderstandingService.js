import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";

const minBusinessConfidence = 0.8;

const outputShape = {
  businessIdentity: {
    businessName: "",
    businessType: "",
    industry: "",
    industryConfidence: 0,
    businessModel: "",
    marketPosition: {
      category: "",
      competitionLevel: "",
      primaryDifferentiator: ""
    }
  },
  websitePurpose: {
    businessGoal: "",
    websitePrimaryGoal: "",
    websiteSecondaryGoals: [],
    primaryConversionAction: "",
    secondaryConversionActions: []
  },
  customerUnderstanding: {
    targetAudience: "",
    customerProfile: "",
    customerJourney: [],
    decisionFactors: [],
    buyingPsychology: {
      emotionalDrivers: [],
      biggestConcerns: [],
      decisionTriggers: []
    }
  },
  businessOffering: {
    mainServices: [],
    serviceCategories: [],
    coreRevenueDrivers: [],
    highestValueServices: []
  },
  websiteSuccessDefinition: {
    primaryAction: "",
    secondaryActions: [],
    criticalPages: [],
    highestValuePages: [],
    highestRiskPages: []
  },
  consultantContext: {
    purchaseComplexity: "",
    salesCycle: "",
    trustImportance: "",
    observationPriorities: [],
    expectedProof: [],
    expectedTrustSignals: [],
    expectedDecisionContent: []
  },
  confidence: {
    overall: 0,
    reasons: []
  }
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanArray(value, max = 12) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, max);
}

function truncate(value, max) {
  return clean(value).slice(0, max);
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}

function normalizeUnderstanding(raw = {}) {
  const identity = raw.businessIdentity || {};
  const websitePurpose = raw.websitePurpose || {};
  const customerUnderstanding = raw.customerUnderstanding || {};
  const buyingPsychology = customerUnderstanding.buyingPsychology || {};
  const businessOffering = raw.businessOffering || {};
  const successDefinition = raw.websiteSuccessDefinition || {};
  const consultantContext = raw.consultantContext || {};
  const confidence = raw.confidence || {};
  const normalized = {
    businessIdentity: {
      businessName: clean(identity.businessName),
      businessType: clean(identity.businessType),
      industry: clean(identity.industry),
      industryConfidence: normalizeConfidence(identity.industryConfidence),
      businessModel: clean(identity.businessModel),
      marketPosition: {
        category: clean(identity.marketPosition?.category),
        competitionLevel: clean(identity.marketPosition?.competitionLevel),
        primaryDifferentiator: clean(identity.marketPosition?.primaryDifferentiator)
      }
    },
    websitePurpose: {
      businessGoal: clean(websitePurpose.businessGoal),
      websitePrimaryGoal: clean(websitePurpose.websitePrimaryGoal),
      websiteSecondaryGoals: cleanArray(websitePurpose.websiteSecondaryGoals, 8),
      primaryConversionAction: clean(websitePurpose.primaryConversionAction),
      secondaryConversionActions: cleanArray(websitePurpose.secondaryConversionActions, 8)
    },
    customerUnderstanding: {
      targetAudience: clean(customerUnderstanding.targetAudience),
      customerProfile: clean(customerUnderstanding.customerProfile),
      customerJourney: cleanArray(customerUnderstanding.customerJourney, 12),
      decisionFactors: cleanArray(customerUnderstanding.decisionFactors, 12),
      buyingPsychology: {
        emotionalDrivers: cleanArray(buyingPsychology.emotionalDrivers, 10),
        biggestConcerns: cleanArray(buyingPsychology.biggestConcerns, 10),
        decisionTriggers: cleanArray(buyingPsychology.decisionTriggers, 10)
      }
    },
    businessOffering: {
      mainServices: cleanArray(businessOffering.mainServices, 16),
      serviceCategories: cleanArray(businessOffering.serviceCategories, 10),
      coreRevenueDrivers: cleanArray(businessOffering.coreRevenueDrivers, 10),
      highestValueServices: cleanArray(businessOffering.highestValueServices, 10)
    },
    websiteSuccessDefinition: {
      primaryAction: clean(successDefinition.primaryAction),
      secondaryActions: cleanArray(successDefinition.secondaryActions, 8),
      criticalPages: cleanArray(successDefinition.criticalPages, 12),
      highestValuePages: cleanArray(successDefinition.highestValuePages, 12),
      highestRiskPages: cleanArray(successDefinition.highestRiskPages, 12)
    },
    consultantContext: {
      purchaseComplexity: clean(consultantContext.purchaseComplexity),
      salesCycle: clean(consultantContext.salesCycle),
      trustImportance: clean(consultantContext.trustImportance),
      observationPriorities: cleanArray(consultantContext.observationPriorities, 12),
      expectedProof: cleanArray(consultantContext.expectedProof, 12),
      expectedTrustSignals: cleanArray(consultantContext.expectedTrustSignals, 12),
      expectedDecisionContent: cleanArray(consultantContext.expectedDecisionContent, 12)
    },
    confidence: {
      overall: normalizeConfidence(confidence.overall ?? identity.industryConfidence),
      reasons: cleanArray(confidence.reasons, 12)
    }
  };

  const confidenceText = normalized.confidence.reasons.join(" ").toLowerCase();
  const reliesOnlyOnWeakHints = confidenceText &&
    !/(heading|homepage|page text|visible text|meta|structured data|schema|service|services|cta|ocr|title|description|content|copy|navigation)/i.test(confidenceText);
  const psychology = normalized.customerUnderstanding.buyingPsychology;
  const rejectionReasons = [
    normalized.confidence.overall < minBusinessConfidence && "overall_confidence_below_0_8",
    normalized.businessIdentity.industryConfidence < minBusinessConfidence && "industry_confidence_below_0_8",
    !normalized.businessIdentity.businessType && "missing_business_type",
    !normalized.businessIdentity.industry && "missing_industry",
    !normalized.businessIdentity.businessModel && "missing_business_model",
    !normalized.websitePurpose.businessGoal && "missing_business_goal",
    !normalized.websitePurpose.websitePrimaryGoal && "missing_website_primary_goal",
    !normalized.websitePurpose.primaryConversionAction && "missing_primary_conversion_action",
    !normalized.customerUnderstanding.targetAudience && "missing_target_audience",
    !normalized.customerUnderstanding.customerProfile && "missing_customer_profile",
    normalized.customerUnderstanding.customerJourney.length < 3 && "customer_journey_too_thin",
    normalized.customerUnderstanding.decisionFactors.length < 2 && "decision_factors_too_thin",
    psychology.emotionalDrivers.length < 2 && "emotional_drivers_too_thin",
    psychology.biggestConcerns.length < 2 && "biggest_concerns_too_thin",
    psychology.decisionTriggers.length < 2 && "decision_triggers_too_thin",
    normalized.businessOffering.mainServices.length < 1 && "missing_main_services",
    !normalized.websiteSuccessDefinition.primaryAction && "missing_success_primary_action",
    normalized.websiteSuccessDefinition.criticalPages.length < 2 && "critical_pages_too_thin",
    !normalized.consultantContext.purchaseComplexity && "missing_purchase_complexity",
    !normalized.consultantContext.salesCycle && "missing_sales_cycle",
    !normalized.consultantContext.trustImportance && "missing_trust_importance",
    normalized.consultantContext.observationPriorities.length < 2 && "observation_priorities_too_thin",
    normalized.confidence.reasons.length < 2 && "confidence_reasons_too_thin",
    reliesOnlyOnWeakHints && "confidence_reasons_only_weak_hints"
  ].filter(Boolean);
  if (rejectionReasons.length) {
    if (process.env.DEBUG_BUSINESS_UNDERSTANDING === "true") {
      console.warn("[business-understanding-rejected]", JSON.stringify({ rejectionReasons, normalized }, null, 2));
    }
    return null;
  }
  return normalized;
}

function compactScanEvidence(scanEvidence = {}) {
  const signals = scanEvidence?.signals || {};
  return {
    status: scanEvidence?.status || null,
    detectorVersion: scanEvidence?.detectorVersion || null,
    businessUnderstanding: scanEvidence?.businessUnderstanding || null,
    signals: Object.fromEntries(
      Object.entries(signals)
        .filter(([, signal]) => ["present", "absent"].includes(signal?.value))
        .slice(0, 40)
        .map(([key, signal]) => [key, {
          value: signal.value,
          confidence: signal.confidence,
          source: signal.source,
          evidence: signal.evidence,
          textRead: signal.textRead || null
        }])
    )
  };
}

function normalizeInput(input = {}) {
  const raw = input.rawExtractedData || {};
  return {
    websiteUrl: clean(input.websiteUrl || input.website || raw.website || raw.canonical),
    homepageHtml: truncate(input.homepageHtml || input.html, 25000),
    ocrText: truncate(input.ocrText, 12000),
    metaTags: input.metaTags || {
      title: input.title || raw.title || "",
      description: input.metaDescription || raw.metaDescription || ""
    },
    structuredData: input.structuredData || raw.structuredData || [],
    scanEvidence: input.scanEvidence || null,
    visibleText: truncate(input.visibleText || raw.visibleText, 14000),
    headings: cleanArray(input.headings || raw.headings, 40),
    links: cleanArray(input.links || raw.links, 80),
    ctas: Array.isArray(input.ctas || raw.ctas) ? (input.ctas || raw.ctas).slice(0, 20) : [],
    companyHint: clean(input.company || input.businessName)
  };
}

function hasEnoughInput(input) {
  return Boolean(
    input.websiteUrl ||
    input.visibleText.length > 120 ||
    input.ocrText.length > 120 ||
    input.homepageHtml.length > 200 ||
    input.headings.length ||
    input.metaTags?.title ||
    input.metaTags?.description
  );
}

function buildPrompt(input) {
  return `Build Phase 1 of Ocia Outreach Intelligence.

Your only responsibility is understanding the business.
Do not write emails.
Do not analyse website improvements.
Do not analyse UX.
Do not analyse SEO.
Do not compare the website to competitors.
Do not recommend changes.

Act like a consultant who has just landed on the homepage and must answer:
"What business am I looking at?"
Then answer:
"What is this business trying to achieve?"
Then answer:
"What is the customer trying to achieve?"

Input evidence:
Website URL: ${input.websiteUrl || "Unknown"}
Company hint: ${input.companyHint || "Unknown"}
Meta tags:
${JSON.stringify(input.metaTags || {}, null, 2)}
Structured data:
${JSON.stringify(input.structuredData || [], null, 2).slice(0, 8000)}
Headings:
${JSON.stringify(input.headings || [], null, 2)}
CTA text:
${JSON.stringify(input.ctas || [], null, 2).slice(0, 5000)}
Links:
${JSON.stringify(input.links || [], null, 2).slice(0, 7000)}
Existing scan evidence:
${JSON.stringify(compactScanEvidence(input.scanEvidence || {}), null, 2)}
OCR text:
${input.ocrText || "None"}
Visible homepage/contact text:
${input.visibleText || "None"}
Homepage HTML excerpt:
${input.homepageHtml || "None"}

Return ONLY strict JSON matching this shape:
${JSON.stringify(outputShape, null, 2)}

Rules:
- Never guess.
- Business identity, industry, services, conversion actions, and audience must be evidence-backed.
- Once the business type is strongly evidence-backed, customer journey, buying psychology, purchase complexity, sales cycle, and trust requirements may use normal consultant reasoning for that verified business type.
- Do not infer industries without evidence.
- If confidence is below 0.8, return null.
- If there is not enough evidence to identify the business, return null.
- confidence.reasons must cite the specific evidence you used.
- Company name, domain, or URL alone are not enough evidence.
- Do not use company hint or URL as the only confidence reason.
- customerJourney, buyingPsychology, websitePurpose, websiteSuccessDefinition, and consultantContext must be based on the verified business type. These are not recommendations.
- marketPosition should describe the market category, competition level, and differentiator only when supported by the homepage evidence.
- No recommendations, no improvements, no outreach, no sales angle, no competitor comparison, no observations.`;
}

export async function understandBusinessFromInput(input = {}) {
  const normalizedInput = normalizeInput(input);
  if (!hasEnoughInput(normalizedInput)) return null;
  if (!process.env.OPENAI_API_KEY) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You classify and understand businesses from provided website evidence only. Return strict JSON or null. Never recommend improvements or write outreach." },
      { role: "user", content: buildPrompt(normalizedInput) }
    ],
    temperature: 0.1
  });
  const content = response.choices[0]?.message?.content || "null";
  const parsed = JSON.parse(content);
  if (parsed === null) return null;
  return normalizeUnderstanding(parsed);
}

function scanResultToInput(scanResult, lead = null) {
  const raw = scanResult?.rawExtractedData || {};
  return {
    websiteUrl: scanResult?.website || lead?.website,
    company: scanResult?.company || lead?.company,
    rawExtractedData: raw,
    title: raw.title,
    metaDescription: raw.metaDescription,
    visibleText: raw.visibleText,
    headings: scanResult?.extractedHeadings || raw.headings,
    ctas: scanResult?.extractedCTAs || raw.ctas,
    links: raw.links,
    structuredData: raw.structuredData,
    scanEvidence: scanResult?.scanEvidence || lead?.scanEvidence
  };
}

export async function understandLeadBusiness(leadId, { persist = true } = {}) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, company: true, website: true, scanEvidence: true }
  });
  if (!lead) throw notFound("Lead not found");

  const scanResult = await prisma.scanResult.findFirst({
    where: { website: lead.website },
    orderBy: { createdAt: "desc" }
  });
  const input = scanResult ? scanResultToInput(scanResult, lead) : {
    websiteUrl: lead.website,
    company: lead.company,
    scanEvidence: lead.scanEvidence
  };
  const understanding = await understandBusinessFromInput(input);
  if (!persist || !understanding) return understanding;

  const nextLeadEvidence = {
    ...(lead.scanEvidence || {}),
    businessUnderstanding: understanding,
    businessUnderstandingStatus: "complete",
    businessUnderstandingUpdatedAt: new Date().toISOString()
  };
  await prisma.lead.update({ where: { id: lead.id }, data: { scanEvidence: nextLeadEvidence } });

  if (scanResult) {
    await prisma.scanResult.update({
      where: { id: scanResult.id },
      data: {
        scanEvidence: {
          ...(scanResult.scanEvidence || {}),
          businessUnderstanding: understanding,
          businessUnderstandingStatus: "complete",
          businessUnderstandingUpdatedAt: new Date().toISOString()
        }
      }
    });
  }

  return understanding;
}

export async function previewLeadBusinessInput(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, company: true, website: true, scanEvidence: true }
  });
  if (!lead) throw notFound("Lead not found");
  const scanResult = await prisma.scanResult.findFirst({
    where: { website: lead.website },
    orderBy: { createdAt: "desc" }
  });
  if (!scanResult) throw new HttpError(404, "No scan result found for this lead");
  return normalizeInput(scanResultToInput(scanResult, lead));
}
