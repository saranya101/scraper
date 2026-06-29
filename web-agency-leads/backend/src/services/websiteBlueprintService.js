import OpenAI from "openai";
import { HttpError } from "../utils/httpError.js";

const blueprintShape = {
  websiteBlueprint: {
    primaryGoal: "",
    secondaryGoals: [],
    customerJourney: [],
    informationArchitecture: {
      criticalPages: [],
      recommendedPages: [],
      pagePriority: []
    },
    conversionArchitecture: {
      primaryCTA: "",
      secondaryCTAs: [],
      conversionFlow: [],
      expectedFrictionPoints: []
    },
    trustArchitecture: {
      requiredTrustSignals: [],
      idealPlacement: [],
      proofHierarchy: []
    },
    contentArchitecture: {
      servicePages: [],
      educationalContent: [],
      faqTopics: [],
      comparisonContent: []
    },
    decisionSupport: {
      questionsToAnswer: [],
      objectionsToHandle: [],
      decisionTriggers: []
    },
    localSEOExpectations: [],
    technicalExpectations: [],
    mobileExpectations: [],
    userExperiencePrinciples: [],
    visualHierarchy: {
      heroPurpose: "",
      aboveFoldContent: [],
      trustPlacement: [],
      ctaPlacement: []
    }
  }
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanArray(value, max = 16) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean).slice(0, max);
}

function requirePhase1(input = {}) {
  const understanding = input.businessUnderstanding || input;
  const identity = understanding.businessIdentity || {};
  const purpose = understanding.websitePurpose || {};
  const customer = understanding.customerUnderstanding || {};
  const confidence = understanding.confidence || {};
  if (
    Number(confidence.overall || 0) < 0.8 ||
    Number(identity.industryConfidence || 0) < 0.8 ||
    !identity.businessType ||
    !identity.industry ||
    !purpose.websitePrimaryGoal ||
    !purpose.primaryConversionAction ||
    !customer.targetAudience
  ) {
    throw new HttpError(422, "Valid Phase 1 business understanding JSON is required");
  }
  return understanding;
}

function normalizeBlueprint(raw = {}) {
  const source = raw.websiteBlueprint || {};
  const ia = source.informationArchitecture || {};
  const conversion = source.conversionArchitecture || {};
  const trust = source.trustArchitecture || {};
  const content = source.contentArchitecture || {};
  const decision = source.decisionSupport || {};
  const visual = source.visualHierarchy || {};
  const normalized = {
    websiteBlueprint: {
      primaryGoal: clean(source.primaryGoal),
      secondaryGoals: cleanArray(source.secondaryGoals),
      customerJourney: cleanArray(source.customerJourney, 16),
      informationArchitecture: {
        criticalPages: cleanArray(ia.criticalPages, 16),
        recommendedPages: cleanArray(ia.recommendedPages, 16),
        pagePriority: cleanArray(ia.pagePriority, 16)
      },
      conversionArchitecture: {
        primaryCTA: clean(conversion.primaryCTA),
        secondaryCTAs: cleanArray(conversion.secondaryCTAs, 12),
        conversionFlow: cleanArray(conversion.conversionFlow, 16),
        expectedFrictionPoints: cleanArray(conversion.expectedFrictionPoints, 16)
      },
      trustArchitecture: {
        requiredTrustSignals: cleanArray(trust.requiredTrustSignals, 16),
        idealPlacement: cleanArray(trust.idealPlacement, 16),
        proofHierarchy: cleanArray(trust.proofHierarchy, 16)
      },
      contentArchitecture: {
        servicePages: cleanArray(content.servicePages, 20),
        educationalContent: cleanArray(content.educationalContent, 16),
        faqTopics: cleanArray(content.faqTopics, 16),
        comparisonContent: cleanArray(content.comparisonContent, 16)
      },
      decisionSupport: {
        questionsToAnswer: cleanArray(decision.questionsToAnswer, 16),
        objectionsToHandle: cleanArray(decision.objectionsToHandle, 16),
        decisionTriggers: cleanArray(decision.decisionTriggers, 16)
      },
      localSEOExpectations: cleanArray(source.localSEOExpectations, 16),
      technicalExpectations: cleanArray(source.technicalExpectations, 16),
      mobileExpectations: cleanArray(source.mobileExpectations, 16),
      userExperiencePrinciples: cleanArray(source.userExperiencePrinciples, 16),
      visualHierarchy: {
        heroPurpose: clean(visual.heroPurpose),
        aboveFoldContent: cleanArray(visual.aboveFoldContent, 12),
        trustPlacement: cleanArray(visual.trustPlacement, 12),
        ctaPlacement: cleanArray(visual.ctaPlacement, 12)
      }
    }
  };

  const blueprint = normalized.websiteBlueprint;
  if (
    !blueprint.primaryGoal ||
    blueprint.customerJourney.length < 3 ||
    blueprint.informationArchitecture.criticalPages.length < 2 ||
    !blueprint.conversionArchitecture.primaryCTA ||
    blueprint.conversionArchitecture.conversionFlow.length < 3 ||
    blueprint.trustArchitecture.requiredTrustSignals.length < 2 ||
    blueprint.decisionSupport.questionsToAnswer.length < 2 ||
    !blueprint.visualHierarchy.heroPurpose
  ) {
    throw new HttpError(422, "Blueprint output was incomplete");
  }
  return normalized;
}

function buildPrompt(businessUnderstanding) {
  return `Build Phase 2 of Ocia Outreach Intelligence.

This phase runs AFTER Business Understanding.
Input is ONLY the Business Understanding JSON from Phase 1.

DO NOT scan the website.
DO NOT compare against the website.
DO NOT generate observations.
DO NOT write emails.
DO NOT recommend changes to an existing website.

Your only job is to design the blueprint of an exceptional website for THIS exact business.
Think like a consultant designing the perfect customer journey.

Business Understanding JSON:
${JSON.stringify(businessUnderstanding, null, 2)}

Objective:
Given this deep understanding of the business, answer:
"If I were building the best website possible for this business, what should it contain?"

The blueprint should represent best practice. It will become the benchmark used by later phases.

Return ONLY strict JSON matching this shape:
${JSON.stringify(blueprintShape, null, 2)}

Rules:
- Use only the Phase 1 business understanding as input.
- Do not mention any real current website condition.
- Do not say what is missing or broken.
- Do not create observations.
- Do not create email copy.
- Do not compare competitors.
- Make the blueprint specific to the business type, buying psychology, conversion goals, purchase complexity, and trust requirements.`;
}

export async function buildWebsiteBlueprint(input = {}) {
  const businessUnderstanding = requirePhase1(input);
  if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "OPENAI_API_KEY is required to build a website blueprint");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You design ideal website blueprints from Phase 1 business understanding only. Return strict JSON. Do not analyse an existing website, write emails, or generate observations." },
      { role: "user", content: buildPrompt(businessUnderstanding) }
    ],
    temperature: 0.25
  });
  return normalizeBlueprint(JSON.parse(response.choices[0]?.message?.content || "{}"));
}

export { blueprintShape };
