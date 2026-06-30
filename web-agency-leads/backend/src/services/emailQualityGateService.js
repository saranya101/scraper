import { HttpError } from "../utils/httpError.js";
import { SERVICE_EMAIL_ANGLES, SERVICE_EMAIL_ANGLE_IDS } from "../constants/serviceEmailAngles.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEmail(input = {}) {
  const email = input.email || input.phase8 || input.generatedEmail || input;
  const subject = clean(email.subject || input.subject || "");
  const body = cleanEmailBody(email.body || email.emailBody || email.fullMessage || input.body || "");
  if (!body) throw new HttpError(422, "Phase 8 email body is required");
  return { subject, body };
}

function cleanEmailBody(value) {
  return String(value || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeObservation(input = {}) {
  const observation = input.selectedObservation || input.observation || input.phase8?.selectedObservation || {};
  return {
    id: clean(observation.id),
    title: clean(observation.title),
    category: clean(observation.category),
    status: clean(observation.status),
    expected: clean(observation.expected),
    actual: clean(observation.actual),
    description: clean(observation.description),
    reasoning: clean(observation.reasoning)
  };
}

function normalizeContext(input = {}) {
  const company = input.company && typeof input.company === "object" ? input.company : {};
  const businessIdentity = input.businessUnderstanding?.businessIdentity || input.phase1?.businessIdentity || {};
  return {
    companyName: clean(company.name || input.companyName || input.lead?.company || ""),
    industry: clean(input.industry || businessIdentity.industry || input.lead?.industry || ""),
    businessType: clean(input.businessType || businessIdentity.businessType || input.lead?.businessType || "")
  };
}

function normalizeReportContext(input = {}) {
  const services = Array.isArray(input.reportContext?.selectedServices)
    ? input.reportContext.selectedServices.map((item) => typeof item === "string" ? { id: item, label: item } : item).filter((item) => item?.id)
    : [];
  return {
    selectedServices: services,
    attachmentEnabled: input.reportContext?.attachmentEnabled === true
  };
}

function sentences(body) {
  return clean(body)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => clean(sentence))
    .filter(Boolean);
}

function textTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3 && !stopWords.has(token));
}

function tokenOverlap(a, b) {
  const left = new Set(textTokens(a));
  const right = new Set(textTokens(b));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) if (right.has(token)) hits += 1;
  return hits / Math.min(left.size, right.size);
}

function includesAny(text, terms) {
  const lower = clean(text).toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function hasCompanySpecificity(body, context) {
  return Boolean(context.companyName && body.toLowerCase().includes(context.companyName.toLowerCase()));
}

function hasIndustrySpecificity(body, context) {
  const lower = body.toLowerCase();
  return Boolean(
    context.businessType && lower.includes(context.businessType.toLowerCase()) ||
    context.industry && lower.includes(context.industry.toLowerCase()) ||
    includesAny(lower, [
      "marine fuel supplier",
      "marine fuel suppliers",
      "fuel suppliers",
      "logistics providers",
      "accounting firms",
      "dental clinics",
      "law firms",
      "restaurants",
      "design studios",
      "clinics"
    ])
  );
}

function hasObservationSpecificity(body, observation) {
  const observationText = clean([
    observation.title,
    observation.expected,
    observation.actual,
    observation.description,
    observation.reasoning
  ].join(" "));
  return tokenOverlap(body, observationText) >= 0.08 || includesAny(body, [
    "next step",
    "enquiry",
    "appointment",
    "pricing",
    "choose",
    "trust",
    "reviews",
    "testimonials",
    "mobile",
    "contact"
  ]);
}

function repeatedMeaning(body) {
  const lines = body
    .split(/\n+/)
    .map((line) => clean(line))
    .filter((line) => line && !/^hi\b/i.test(line) && !/^was that intentional\??$/i.test(line));
  for (let index = 0; index < lines.length; index += 1) {
    for (let next = index + 1; next < lines.length; next += 1) {
      if (tokenOverlap(lines[index], lines[next]) >= 0.62) return true;
    }
  }
  return false;
}

function everySentenceAddsInformation(body) {
  const useful = sentences(body).filter((sentence) => !/^hi\b/i.test(sentence));
  if (!useful.length) return false;
  return useful.every((sentence) => {
    const lower = sentence.toLowerCase();
    if (sentence.length < 8) return false;
    if (/^(thanks|best|regards)$/i.test(sentence)) return false;
    if (includesAny(lower, ["hope this message finds you well", "just checking in"])) return false;
    return true;
  });
}

function questionIsNatural(body) {
  const matches = body.match(/\?/g) || [];
  if (matches.length === 0) {
    return includesAny(body, [
      "happy to send over a quick breakdown if this is something you are looking at improving"
    ]);
  }
  if (matches.length !== 1) return false;
  const questionMatch = body.match(/(^|[\n.!?])\s*([^.!?\n][^.!?\n]*\?)/);
  const question = clean(questionMatch?.[2] || "");
  if (!question) return false;
  return !includesAny(question, [
    "schedule",
    "calendar",
    "meeting",
    "call",
    "demo",
    "book",
    "interested in our",
    "would you like to learn"
  ]);
}

function soundsHuman(body) {
  const lower = body.toLowerCase();
  if (includesAny(lower, forbiddenPhrases.filter((phrase) => phrase !== "ai"))) return false;
  if (/(unlock|transform|elevate|leverage|streamline|cutting-edge|game-changing)/i.test(body)) return false;
  return true;
}

function couldSendToAnyone(body, context) {
  const lower = body.toLowerCase();
  if (!hasCompanySpecificity(lower, context)) return true;
  if (hasIndustrySpecificity(lower, context)) return false;
  return includesAny(lower, [
    "your online presence",
    "your digital presence",
    "your website could be improved",
    "i help businesses like yours",
    "companies like yours",
    "similar options"
  ]);
}

function serviceMatchDetails(body, reportContext) {
  const lower = body.toLowerCase();
  const selected = reportContext.selectedServices || [];
  const selectedIds = new Set(selected.map((item) => item.id));
  const requiredTerms = selected.flatMap((item) => {
    const angle = SERVICE_EMAIL_ANGLES[item.id] || {};
    return [item.label, angle.phrase, angle.improvementPhrase].map(clean).filter(Boolean);
  });
  const matchesSelected = !requiredTerms.length || requiredTerms.some((term) => lower.includes(term.toLowerCase()));
  const mentionsUnselected = SERVICE_EMAIL_ANGLE_IDS.some((id) => {
    if (selectedIds.has(id)) return false;
    const angle = SERVICE_EMAIL_ANGLES[id];
    return [angle?.phrase, angle?.improvementPhrase].filter(Boolean).some((term) => lower.includes(term.toLowerCase()));
  });
  return { matchesSelected, mentionsUnselected };
}

function scoreFromFailures(failedChecks) {
  if (!failedChecks.length) return 9;
  return Math.max(1, Math.min(8, 9 - failedChecks.length));
}

function reasonForFailure(failedChecks) {
  if (failedChecks.includes("service_mismatch")) return "Email does not match selected PDF services. Regenerate email.";
  if (failedChecks.includes("mentions_unselected_services")) return "The email mentions services that were not selected for the report.";
  if (failedChecks.includes("missing_report_reference")) return "The email does not mention the attached report even though attachment is enabled.";
  if (failedChecks.includes("generic")) return "The email is too generic and could be sent to almost any company.";
  if (failedChecks.includes("not_specific_to_business")) return "The email does not feel specific enough to this business.";
  if (failedChecks.includes("sounds_ai_generated")) return "The email sounds too much like an automated agency email.";
  if (failedChecks.includes("repetitive")) return "The email repeats the same idea in different wording.";
  if (failedChecks.includes("weak_question")) return "The closing question does not feel natural enough.";
  if (failedChecks.includes("not_specific_to_observation")) return "The email does not clearly connect to the selected services and main issue.";
  return "The email is not strong enough to send.";
}

function feedbackKey(check) {
  return {
    service_mismatch: "serviceMismatch",
    mentions_unselected_services: "mentionsUnselectedServices",
    missing_report_reference: "missingReportReference",
    not_personalised: "notPersonalised",
    not_specific_to_observation: "notSpecificToObservation",
    not_specific_to_business: "notSpecificToBusiness",
    sounds_ai_generated: "soundsAiGenerated",
    sentence_filler: "sentenceFiller",
    weak_question: "weakQuestion"
  }[check] || check;
}

function feedbackMessage(check, { context }) {
  const hasIndustryContext = Boolean(context.industry || context.businessType);
  return {
    service_mismatch: "Email does not match selected PDF services. Regenerate email.",
    mentions_unselected_services: "The email references services that were not selected for the attached report.",
    missing_report_reference: "The email should mention the attached website opportunity report only when report attachment is enabled.",
    generic: "The wording could apply to almost any business.",
    not_personalised: hasIndustryContext
      ? "The email does not reference anything unique about this company's industry, business type, or website."
      : "The email does not reference enough specific detail from the company or website.",
    not_specific_to_observation: "The email does not clearly connect back to the selected services and main issue.",
    not_specific_to_business: "The email does not reference the company in a way that makes it feel written for this business.",
    sounds_ai_generated: "The email contains wording that feels automated, agency-like, or too polished.",
    repetitive: "The email repeats the same idea in different wording.",
    sentence_filler: "One or more sentences do not add clear new information.",
    weak_question: "The closing question feels unnatural, pushy, or asks for more than a simple reply."
  }[check] || "This check failed.";
}

function buildFeedback(failedChecks, details) {
  return failedChecks.reduce((feedback, check) => {
    feedback[feedbackKey(check)] = feedbackMessage(check, details);
    return feedback;
  }, {});
}

export function evaluateEmailQuality(input = {}) {
  const email = normalizeEmail(input);
  const observation = normalizeObservation(input);
  const context = normalizeContext(input);
  const reportContext = normalizeReportContext(input);
  const failedChecks = [];
  const serviceDetails = reportContext.selectedServices.length ? serviceMatchDetails(email.body, reportContext) : { matchesSelected: false, mentionsUnselected: false };
  const observationSpecific = hasObservationSpecificity(email.body, observation) || serviceDetails.matchesSelected;

  if (couldSendToAnyone(email.body, context)) failedChecks.push("generic", "not_personalised");
  if (!observationSpecific) failedChecks.push("not_specific_to_observation");
  if (!hasCompanySpecificity(email.body, context)) failedChecks.push("not_specific_to_business");
  if (!soundsHuman(email.body)) failedChecks.push("sounds_ai_generated");
  if (repeatedMeaning(email.body)) failedChecks.push("repetitive");
  if (!everySentenceAddsInformation(email.body)) failedChecks.push("sentence_filler");
  if (!questionIsNatural(email.body)) failedChecks.push("weak_question");
  if (reportContext.selectedServices.length) {
    if (!serviceDetails.matchesSelected) failedChecks.push("service_mismatch");
    if (serviceDetails.mentionsUnselected) failedChecks.push("mentions_unselected_services");
    if (reportContext.attachmentEnabled && !/attached a short website opportunity report/i.test(email.body)) failedChecks.push("missing_report_reference");
  }

  const uniqueFailures = [...new Set(failedChecks)];
  const approved = uniqueFailures.length === 0;
  return {
    approved,
    reason: approved ? "The email feels personal, specific, and human enough to send." : reasonForFailure(uniqueFailures),
    qualityScore: scoreFromFailures(uniqueFailures),
    failedChecks: uniqueFailures,
    feedback: buildFeedback(uniqueFailures, { context })
  };
}

const forbiddenPhrases = [
  "audit",
  "analysis",
  "artificial intelligence",
  "consultant",
  "consulting",
  "funnel",
  "cro",
  "user experience",
  "value proposition",
  "marketing",
  "meeting",
  "schedule a call",
  "book a call",
  "demo",
  "free consultation"
];

const stopWords = new Set([
  "this",
  "that",
  "with",
  "from",
  "your",
  "you",
  "someone",
  "would",
  "could",
  "should",
  "there",
  "their",
  "what",
  "when",
  "where",
  "after",
  "before",
  "over",
  "into",
  "about",
  "earlier",
  "still",
  "first",
  "time"
]);
