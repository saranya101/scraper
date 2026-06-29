import { HttpError } from "../utils/httpError.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clampInterest(value) {
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

function normalizeInputs(input = {}) {
  const quality = array(input.conversationQuality?.conversationQuality || input.conversationQuality || input.phase6?.conversationQuality)
    .filter((item) => item?.keep)
    .map((item) => ({
      id: clean(item.id),
      keep: Boolean(item.keep),
      reason: clean(item.reason),
      conversationValue: Number.isFinite(Number(item.conversationValue)) ? Number(item.conversationValue) : 1
    }))
    .filter((item) => item.id);

  const observationsById = new Map(
    array(input.scoredObservations || input.observations || input.phase5?.scoredObservations)
      .map((observation) => [clean(observation.id), observation])
      .filter(([id]) => id)
  );

  if (!quality.length) throw new HttpError(422, "Phase 6 kept observations are required");
  return quality.map((item) => ({
    quality: item,
    observation: observationsById.get(item.id) || { id: item.id }
  }));
}

function isCommerciallyInteresting(text, observation = {}) {
  return (
    includesAny(text, [
      "booking",
      "appointment",
      "contact",
      "enquiry",
      "inquiry",
      "quote",
      "pricing",
      "cost",
      "trust",
      "review",
      "testimonial",
      "certification",
      "credential",
      "case study",
      "proof",
      "mobile",
      "conversion",
      "revenue",
      "lead",
      "customer",
      "client",
      "patient"
    ]) ||
    ["Booking", "Conversion", "Trust", "Proof", "Social Proof", "Pricing", "Decision Support", "User Experience", "Mobile"].includes(observation.category)
  );
}

function isOwnerObvious(text, observation = {}) {
  if (["present", "exceeds_expectation"].includes(observation.status) && Number(observation.scores?.overallScore || 0) < 7) return true;
  return includesAny(text, [
    "phone number is present",
    "email address is present",
    "analytics tracking is present",
    "ssl enabled",
    "home is present",
    "contact is present",
    "services is present",
    "meta title",
    "meta description"
  ]);
}

function interestLevel(item) {
  const observation = item.observation || {};
  const scores = observation.scores || {};
  const text = textBlob(
    observation.title,
    observation.description,
    observation.expected,
    observation.actual,
    observation.category,
    observation.status,
    item.quality.reason
  );
  let level =
    item.quality.conversationValue * 0.45 +
    Number(scores.overallScore || 0) * 0.25 +
    Number(scores.businessImpact || 0) * 0.15 +
    Math.max(Number(scores.conversionImpact || 0), Number(scores.trustImpact || 0), Number(scores.customerJourneyImpact || 0)) * 0.15;

  if (["absent", "partial", "unclear"].includes(observation.status)) level += 1;
  if (isCommerciallyInteresting(text, observation)) level += 0.8;
  if (isOwnerObvious(text, observation)) level -= 3;
  if (observation.category === "Technical" || observation.category === "SEO") level -= 1.5;
  if (includesAny(text, ["certification", "testimonial", "pricing", "booking", "mobile", "case study", "proof", "contact form"])) level += 0.8;
  return clampInterest(level);
}

function evaluateOwnerInterest(item) {
  const observation = item.observation || {};
  const text = textBlob(observation.title, observation.description, observation.expected, observation.actual, observation.category, item.quality.reason);
  const level = interestLevel(item);
  const commerciallyInteresting = isCommerciallyInteresting(text, observation);
  const obvious = isOwnerObvious(text, observation);
  const wouldReply = level >= 7 && commerciallyInteresting && !obvious;
  return {
    id: item.quality.id,
    wouldReply,
    reason: wouldReply
      ? `As the owner, I would likely care because this connects to ${observation.category || "a business"} issue with enough commercial relevance to continue the conversation.`
      : obvious
        ? "As the owner, I would probably already know this or see it as too obvious to reply to."
        : "As the owner, I would not find this commercially interesting enough to continue the conversation.",
    interestLevel: level
  };
}

export function filterOwnerInterest(input = {}) {
  return {
    ownerInterest: normalizeInputs(input).map(evaluateOwnerInterest)
  };
}
