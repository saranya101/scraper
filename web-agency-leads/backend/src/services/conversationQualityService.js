import { HttpError } from "../utils/httpError.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clampValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function textBlob(...values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).map(clean).filter(Boolean).join(" ").toLowerCase();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function normalizeScoredObservations(input = {}) {
  const source = input.scoredObservations || input.observations || input.phase5?.scoredObservations || [];
  if (!Array.isArray(source)) throw new HttpError(422, "Phase 5 scored observations are required");
  const observations = source
    .map((observation, index) => ({
      ...observation,
      id: clean(observation.id || `observation-${index + 1}`),
      title: clean(observation.title),
      description: clean(observation.description),
      category: clean(observation.category || "Content"),
      expected: clean(observation.expected),
      actual: clean(observation.actual),
      status: clean(observation.status || "unclear"),
      confidence: Number.isFinite(Number(observation.confidence)) ? Number(observation.confidence) : 0.5,
      supportingEvidence: array(observation.supportingEvidence).map(clean).filter(Boolean),
      blueprintSection: clean(observation.blueprintSection),
      scores: observation.scores || {}
    }))
    .filter((observation) => observation.id);
  if (!observations.length) throw new HttpError(422, "At least one scored observation is required");
  return observations;
}

function isGapStatus(status) {
  return ["absent", "partial", "unclear"].includes(status);
}

function isTechnicalOnly(observation) {
  const text = textBlob(observation.title, observation.description, observation.expected, observation.actual);
  if (observation.category !== "Technical" && observation.category !== "SEO") return false;
  return !includesAny(text, ["booking", "contact", "enquiry", "inquiry", "lead", "appointment", "quote", "revenue", "trust", "review", "local", "mobile", "speed"]);
}

function isGenericOrObvious(observation) {
  const text = textBlob(observation.title, observation.expected, observation.actual, observation.category);
  if (["present", "exceeds_expectation"].includes(observation.status) && !isHighlyConversationWorthy(observation)) return true;
  return includesAny(text, [
    "meta title",
    "meta description",
    "ssl enabled",
    "analytics tracking",
    "phone number is present",
    "email address is present",
    "home is present",
    "contact is present",
    "services is present",
    "navigation is present"
  ]);
}

function isHighlyConversationWorthy(observation) {
  const text = textBlob(observation.title, observation.description, observation.expected, observation.actual, observation.category);
  return includesAny(text, [
    "pricing",
    "booking",
    "appointment",
    "testimonial",
    "review",
    "certification",
    "case study",
    "case studies",
    "proof",
    "trust",
    "contact form",
    "mobile",
    "decision",
    "comparison",
    "portfolio"
  ]);
}

function conversationValue(observation) {
  const scores = observation.scores || {};
  const overall = Number(scores.overallScore || 0);
  const businessImpact = Number(scores.businessImpact || 0);
  const conversationPotential = Number(scores.conversationPotential || 0);
  const journey = Number(scores.customerJourneyImpact || 0);
  const trust = Number(scores.trustImpact || 0);
  const conversion = Number(scores.conversionImpact || 0);
  let value =
    overall * 0.35 +
    businessImpact * 0.18 +
    conversationPotential * 0.18 +
    Math.max(journey, trust, conversion) * 0.18 +
    Number(scores.specificity || 0) * 0.06 +
    Number(scores.uniqueness || 0) * 0.05;

  if (isGapStatus(observation.status)) value += 1;
  if (["Conversion", "Booking", "Trust", "Proof", "Social Proof", "Decision Support", "Pricing", "User Experience", "Mobile"].includes(observation.category)) value += 0.5;
  if (["present", "exceeds_expectation"].includes(observation.status)) value -= 2;
  if (isTechnicalOnly(observation)) value -= 2.5;
  if (isGenericOrObvious(observation)) value -= 1.5;
  return clampValue(value);
}

function rejectionReason(observation, value) {
  const scores = observation.scores || {};
  if (isTechnicalOnly(observation)) return "Rejected because this is a technical finding without a clear commercial consequence.";
  if (Number(scores.businessImpact || 0) < 5 || Number(scores.conversationPotential || 0) < 5) return "Rejected because the business impact or conversation potential is too low.";
  if (isGenericOrObvious(observation)) return "Rejected because the owner likely already knows this or it reads like a generic audit finding.";
  if (!isGapStatus(observation.status) && !isHighlyConversationWorthy(observation)) return "Rejected because it describes an existing feature rather than a useful business conversation.";
  if (value < 6) return "Rejected because it is unlikely to make the owner say 'tell me more.'";
  return "";
}

function keepReason(observation, value) {
  const status = observation.status;
  const category = observation.category;
  return `Kept because this ${status} ${category} observation has enough business relevance and specificity to start a useful owner-level conversation. Conversation value: ${value}/10.`;
}

function evaluateObservation(observation) {
  const value = conversationValue(observation);
  const reasonToReject = rejectionReason(observation, value);
  const keep = !reasonToReject;
  return {
    id: observation.id,
    keep,
    reason: keep ? keepReason(observation, value) : reasonToReject,
    conversationValue: value
  };
}

export function filterConversationQuality(input = {}) {
  const scoredObservations = normalizeScoredObservations(input);
  return {
    conversationQuality: scoredObservations.map(evaluateObservation)
  };
}
