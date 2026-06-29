import { HttpError } from "../utils/httpError.js";

const validCategories = new Set([
  "Trust",
  "Conversion",
  "Navigation",
  "Content",
  "Services",
  "Decision Support",
  "Proof",
  "Social Proof",
  "Pricing",
  "Booking",
  "Local",
  "SEO",
  "Technical",
  "User Experience",
  "Mobile"
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clampScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function clampConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Number(Math.max(0.1, Math.min(1, parsed)).toFixed(2));
}

function normalizeBusinessUnderstanding(input = {}) {
  const source = input.businessUnderstanding || input.phase1 || input;
  const identity = source.businessIdentity || {};
  const purpose = source.websitePurpose || {};
  const customer = source.customerUnderstanding || {};
  const psychology = customer.buyingPsychology || {};
  const offering = source.businessOffering || {};
  const success = source.websiteSuccessDefinition || {};
  const consultant = source.consultantContext || {};
  return {
    industry: clean(identity.industry || source.industry),
    businessType: clean(identity.businessType || source.businessType),
    businessModel: clean(identity.businessModel),
    websitePrimaryGoal: clean(purpose.websitePrimaryGoal),
    primaryConversionAction: clean(purpose.primaryConversionAction || success.primaryAction),
    secondaryConversionActions: array(purpose.secondaryConversionActions || success.secondaryActions).map(clean).filter(Boolean),
    decisionFactors: array(customer.decisionFactors).map(clean).filter(Boolean),
    biggestConcerns: array(psychology.biggestConcerns).map(clean).filter(Boolean),
    decisionTriggers: array(psychology.decisionTriggers).map(clean).filter(Boolean),
    mainServices: array(offering.mainServices).map(clean).filter(Boolean),
    coreRevenueDrivers: array(offering.coreRevenueDrivers).map(clean).filter(Boolean),
    highestValueServices: array(offering.highestValueServices).map(clean).filter(Boolean),
    criticalPages: array(success.criticalPages).map(clean).filter(Boolean),
    purchaseComplexity: clean(consultant.purchaseComplexity),
    salesCycle: clean(consultant.salesCycle),
    trustImportance: clean(consultant.trustImportance),
    observationPriorities: array(consultant.observationPriorities).map(clean).filter(Boolean),
    expectedProof: array(consultant.expectedProof).map(clean).filter(Boolean),
    expectedTrustSignals: array(consultant.expectedTrustSignals).map(clean).filter(Boolean),
    expectedDecisionContent: array(consultant.expectedDecisionContent).map(clean).filter(Boolean)
  };
}

function normalizeObservations(input = {}) {
  const observations = input.observations || input.gapAnalysis || input.phase4Observations || [];
  if (!Array.isArray(observations)) throw new HttpError(422, "Phase 4 Gap Analysis observations are required");
  return observations
    .map((observation, index) => ({
      ...observation,
      id: clean(observation.id || `observation-${index + 1}`),
      title: clean(observation.title),
      description: clean(observation.description),
      category: validCategories.has(observation.category) ? observation.category : "Content",
      expected: clean(observation.expected),
      actual: clean(observation.actual),
      status: clean(observation.status || "unclear"),
      confidence: Number.isFinite(Number(observation.confidence)) ? Number(observation.confidence) : 0.5,
      supportingEvidence: array(observation.supportingEvidence).map(clean).filter(Boolean),
      blueprintSection: clean(observation.blueprintSection),
      reasoning: clean(observation.reasoning)
    }))
    .filter((observation) => observation.id && observation.expected && observation.supportingEvidence.length);
}

function textBlob(...values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).map(clean).filter(Boolean).join(" ").toLowerCase();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function businessTraits(business) {
  const text = textBlob(
    business.industry,
    business.businessType,
    business.businessModel,
    business.websitePrimaryGoal,
    business.primaryConversionAction,
    business.decisionFactors,
    business.biggestConcerns,
    business.decisionTriggers,
    business.purchaseComplexity,
    business.salesCycle,
    business.trustImportance,
    business.observationPriorities,
    business.expectedProof,
    business.expectedTrustSignals,
    business.expectedDecisionContent
  );
  const trustHeavy = includesAny(text, ["medical", "clinic", "dental", "dentist", "health", "legal", "law", "finance", "financial", "trust", "credibility", "certification", "doctor", "patient", "high trust"]);
  const leadGen = includesAny(text, ["lead", "enquiry", "enquiries", "inquiry", "contact", "quote", "consultation", "appointment", "booking", "sales call", "service business"]);
  const b2bHighConsideration = includesAny(text, ["b2b", "enterprise", "industrial", "consulting", "professional", "high consideration", "long sales", "complex", "decision maker", "stakeholder", "proof", "case study"]);
  const localIntent = includesAny(text, ["local", "near", "location", "clinic", "restaurant", "contractor", "home services", "maps", "area"]);
  return { trustHeavy, leadGen, b2bHighConsideration, localIntent, text };
}

function baseByCategory(category) {
  const table = {
    Booking: { businessImpact: 8, conversionImpact: 9, customerJourneyImpact: 8, trustImpact: 4, conversationPotential: 7 },
    Conversion: { businessImpact: 8, conversionImpact: 9, customerJourneyImpact: 7, trustImpact: 4, conversationPotential: 7 },
    Trust: { businessImpact: 7, conversionImpact: 5, customerJourneyImpact: 6, trustImpact: 9, conversationPotential: 7 },
    Proof: { businessImpact: 7, conversionImpact: 5, customerJourneyImpact: 6, trustImpact: 9, conversationPotential: 7 },
    "Social Proof": { businessImpact: 7, conversionImpact: 5, customerJourneyImpact: 6, trustImpact: 8, conversationPotential: 7 },
    "Decision Support": { businessImpact: 7, conversionImpact: 6, customerJourneyImpact: 8, trustImpact: 6, conversationPotential: 8 },
    Pricing: { businessImpact: 7, conversionImpact: 6, customerJourneyImpact: 8, trustImpact: 5, conversationPotential: 8 },
    Services: { businessImpact: 7, conversionImpact: 6, customerJourneyImpact: 7, trustImpact: 5, conversationPotential: 6 },
    Navigation: { businessImpact: 5, conversionImpact: 5, customerJourneyImpact: 8, trustImpact: 4, conversationPotential: 5 },
    Content: { businessImpact: 5, conversionImpact: 4, customerJourneyImpact: 6, trustImpact: 5, conversationPotential: 5 },
    Local: { businessImpact: 6, conversionImpact: 5, customerJourneyImpact: 5, trustImpact: 5, conversationPotential: 5 },
    "User Experience": { businessImpact: 6, conversionImpact: 6, customerJourneyImpact: 8, trustImpact: 4, conversationPotential: 5 },
    Mobile: { businessImpact: 6, conversionImpact: 7, customerJourneyImpact: 8, trustImpact: 4, conversationPotential: 5 },
    SEO: { businessImpact: 4, conversionImpact: 3, customerJourneyImpact: 3, trustImpact: 3, conversationPotential: 3 },
    Technical: { businessImpact: 4, conversionImpact: 3, customerJourneyImpact: 4, trustImpact: 3, conversationPotential: 3 }
  };
  return table[category] || table.Content;
}

function statusAdjustment(status) {
  if (status === "absent") return 2;
  if (status === "unclear") return 1;
  if (status === "partial") return 1;
  if (status === "present") return -3;
  if (status === "exceeds_expectation") return -4;
  return 0;
}

function opportunityMultiplier(status) {
  if (status === "absent") return 1.18;
  if (status === "partial") return 1.1;
  if (status === "unclear") return 1.04;
  if (status === "present") return 0.72;
  if (status === "exceeds_expectation") return 0.58;
  return 1;
}

function isGapStatus(status) {
  return ["absent", "partial", "unclear"].includes(status);
}

function isHighlyConversationWorthyPresent(observation) {
  const text = textBlob(observation.title, observation.description, observation.expected, observation.actual, observation.category, observation.blueprintSection);
  if (!["present", "exceeds_expectation"].includes(observation.status)) return false;
  if (!["Decision Support", "Pricing", "Proof", "Trust", "Social Proof"].includes(observation.category)) return false;
  return includesAny(text, ["pricing", "case study", "case studies", "testimonial", "review", "certification", "credential", "comparison", "proof", "portfolio"]);
}

function industryAdjustedScores(observation, business) {
  const traits = businessTraits(business);
  const text = textBlob(observation.title, observation.description, observation.expected, observation.actual, observation.category, observation.blueprintSection);
  const base = { ...baseByCategory(observation.category) };
  const adjustment = statusAdjustment(observation.status);

  base.businessImpact += adjustment;
  base.conversationPotential += adjustment;

  if (traits.trustHeavy && ["Trust", "Proof", "Social Proof"].includes(observation.category)) {
    base.businessImpact += 1;
    base.trustImpact += 1;
    base.conversationPotential += 1;
  }
  if (traits.leadGen && ["Conversion", "Booking", "Mobile", "User Experience"].includes(observation.category)) {
    base.businessImpact += 1;
    base.conversionImpact += 1;
    base.customerJourneyImpact += 1;
  }
  if (traits.b2bHighConsideration && ["Proof", "Decision Support", "Services", "Trust", "Pricing"].includes(observation.category)) {
    base.businessImpact += 1;
    base.customerJourneyImpact += 1;
    base.conversationPotential += 1;
  }
  if (traits.localIntent && observation.category === "Local") {
    base.businessImpact += 1;
    base.conversionImpact += 1;
  }

  if (includesAny(text, ["primary cta", "contact", "book", "appointment", "quote", "enquiry", "inquiry", "phone", "form"])) {
    base.conversionImpact += 1;
    base.customerJourneyImpact += 1;
  }
  if (includesAny(text, ["review", "testimonial", "certification", "credential", "award", "profile", "case stud", "proof"])) {
    base.trustImpact += 1;
  }
  if (["SEO", "Technical"].includes(observation.category) && !includesAny(text, ["contact", "booking", "enquiry", "lead", "appointment", "local", "maps", "speed", "mobile"])) {
    base.businessImpact -= 2;
    base.conversationPotential -= 2;
    base.conversionImpact -= 1;
  }
  if (["present", "exceeds_expectation"].includes(observation.status) && !isHighlyConversationWorthyPresent(observation)) {
    base.businessImpact -= 2;
    base.conversionImpact -= 2;
    base.customerJourneyImpact -= 1;
    base.trustImpact -= 1;
    base.conversationPotential -= 3;
  }
  if (isGapStatus(observation.status) && ["Conversion", "Booking", "Trust", "Proof", "Social Proof", "Decision Support", "Pricing", "User Experience", "Mobile"].includes(observation.category)) {
    base.businessImpact += 1;
    base.conversationPotential += 1;
  }

  return {
    ...base,
    specificity: specificityScore(observation),
    uniqueness: uniquenessScore(observation, business),
    evidenceConfidence: evidenceConfidence(observation)
  };
}

function specificityScore(observation) {
  let score = 4;
  const text = textBlob(observation.expected, observation.actual, observation.blueprintSection);
  if (observation.supportingEvidence.length >= 2) score += 1;
  if (observation.actual.length > 18 && !/available evidence|unclear/i.test(observation.actual)) score += 2;
  if (includesAny(text, ["pricing", "booking", "appointment", "certification", "testimonial", "service page", "contact form", "mobile"])) score += 1;
  if (["absent", "partial", "unclear"].includes(observation.status)) score += 1;
  if (observation.status === "present") score -= 2;
  if (observation.status === "exceeds_expectation") score -= 3;
  return clampScore(score);
}

function uniquenessScore(observation, business) {
  let score = 4;
  const text = textBlob(observation.expected, observation.actual, observation.category, business.industry, business.businessType, business.highestValueServices);
  if (includesAny(text, ["certification", "testimonial", "case study", "pricing", "booking", "high-value", "specialist", "portfolio", "clinician", "doctor", "industrial", "enterprise"])) score += 2;
  if (observation.category === "Technical" || observation.category === "SEO") score -= 1;
  if (observation.status === "present") score -= 2;
  if (observation.status === "exceeds_expectation") score -= 3;
  if (observation.status === "absent") score += 1;
  if (observation.status === "partial") score += 1;
  return clampScore(score);
}

function evidenceConfidence(observation) {
  const base = clampConfidence(observation.confidence);
  const supportBoost = Math.min(0.12, observation.supportingEvidence.length * 0.03);
  const statusPenalty = observation.status === "unclear" ? 0.18 : observation.status === "partial" ? 0.06 : 0;
  return clampConfidence(base + supportBoost - statusPenalty);
}

function overallScore(scores) {
  const weighted =
    scores.businessImpact * 0.25 +
    scores.conversionImpact * 0.20 +
    scores.customerJourneyImpact * 0.15 +
    scores.trustImpact * 0.10 +
    scores.conversationPotential * 0.10 +
    scores.specificity * 0.10 +
    scores.uniqueness * 0.10;
  return Number((weighted * scores.evidenceConfidence).toFixed(2));
}

function adjustedOverallScore(observation, scores) {
  let score = overallScore(scores) * opportunityMultiplier(observation.status);
  if (["present", "exceeds_expectation"].includes(observation.status) && !isHighlyConversationWorthyPresent(observation)) {
    score = Math.min(score, 5.4);
  }
  if (observation.status === "exceeds_expectation") score = Math.min(score, 4.8);
  if (isGapStatus(observation.status) && ["Conversion", "Booking", "Trust", "Proof", "Social Proof", "Decision Support", "Pricing", "User Experience", "Mobile"].includes(observation.category)) {
    score += 0.35;
  }
  return Number(Math.max(0.1, Math.min(10, score)).toFixed(2));
}

function scoreObservation(observation, business) {
  const rawScores = industryAdjustedScores(observation, business);
  const scores = {
    businessImpact: clampScore(rawScores.businessImpact),
    specificity: clampScore(rawScores.specificity),
    uniqueness: clampScore(rawScores.uniqueness),
    conversationPotential: clampScore(rawScores.conversationPotential),
    customerJourneyImpact: clampScore(rawScores.customerJourneyImpact),
    trustImpact: clampScore(rawScores.trustImpact),
    conversionImpact: clampScore(rawScores.conversionImpact),
    evidenceConfidence: rawScores.evidenceConfidence
  };
  scores.overallScore = adjustedOverallScore(observation, scores);
  return {
    ...observation,
    scores,
    scoreReasoning: reasoningForScore(observation, business, scores)
  };
}

function reasoningForScore(observation, business, scores) {
  const traits = businessTraits(business);
  const context = [
    traits.trustHeavy && "trust-heavy business",
    traits.leadGen && "lead-generation or enquiry-driven website",
    traits.b2bHighConsideration && "higher-consideration decision process",
    traits.localIntent && "local-intent business"
  ].filter(Boolean).join(", ") || "general business context";
  return `Scored as ${observation.category} in a ${context}. Status "${observation.status}" shaped the opportunity weight, so gaps outrank merely present items unless the present item is unusually conversation-worthy. SEO/technical categories are kept lower unless tied to conversion, trust, local discovery, speed, or mobile journey.`;
}

function rankingSummary(scoredObservations) {
  const sorted = [...scoredObservations].sort((a, b) => {
    const diff = b.scores.overallScore - a.scores.overallScore;
    if (Math.abs(diff) > 0.25) return diff;
    if (isGapStatus(a.status) !== isGapStatus(b.status)) return isGapStatus(a.status) ? -1 : 1;
    return b.scores.conversionImpact + b.scores.trustImpact + b.scores.customerJourneyImpact - (a.scores.conversionImpact + a.scores.trustImpact + a.scores.customerJourneyImpact);
  });
  const topRanked = sorted.filter((observation) => observation.category !== "Technical" || observation.scores.overallScore >= 6);
  const categoryTotals = new Map();
  scoredObservations.forEach((observation) => {
    const current = categoryTotals.get(observation.category) || { total: 0, count: 0 };
    current.total += observation.scores.overallScore;
    current.count += 1;
    categoryTotals.set(observation.category, current);
  });
  const topCategories = [...categoryTotals.entries()]
    .map(([category, value]) => ({ category, averageScore: Number((value.total / value.count).toFixed(2)), count: value.count }))
    .sort((a, b) => b.averageScore - a.averageScore)
    .slice(0, 5);
  return {
    topCategories,
    highestScoringObservationIds: topRanked.slice(0, 5).map((item) => item.id),
    lowestScoringObservationIds: sorted.slice(-5).reverse().map((item) => item.id),
    notes: [
      "Scores are deterministic and use Phase 1 business context plus Phase 4 observations only.",
      "Absent, partial, and unclear observations receive opportunity weighting so they usually outrank present strengths.",
      "SEO and technical issues are intentionally down-weighted unless they clearly connect to conversion, trust, local discovery, speed, or mobile journey.",
      "No new observations, recommendations, or email copy are generated in Phase 5."
    ]
  };
}

export function scoreObservations(input = {}) {
  const businessUnderstanding = normalizeBusinessUnderstanding(input);
  const observations = normalizeObservations(input);
  if (!observations.length) throw new HttpError(422, "At least one Phase 4 observation is required");
  const scoredObservations = observations.map((observation) => scoreObservation(observation, businessUnderstanding));
  return {
    scoredObservations,
    rankingSummary: rankingSummary(scoredObservations)
  };
}
