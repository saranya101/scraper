import { countEmailWords, EMAIL_WORD_MAX, EMAIL_WORD_MIN } from "../utils/emailWordLimit.js";
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
    selectedServices: services
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
  if (/\bai\b/i.test(body)) return false;
  if (includesAny(lower, forbiddenPhrases.filter((phrase) => phrase !== "ai"))) return false;
  if (/(unlock|transform|elevate|leverage|streamline|cutting-edge|game-changing)/i.test(body)) return false;
  return true;
}

function couldSendToAnyone(body, context) {
  const lower = body.toLowerCase();
  if (!hasCompanySpecificity(lower, context)) return true;
  if ((context.industry || context.businessType) && !hasIndustrySpecificity(lower, context)) return true;
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
  if (failedChecks.includes("missing_report_reference")) return "The email does not mention the attached report even though the report is enabled.";
  if (failedChecks.includes("generic")) return "The email is too generic and could be sent to almost any company.";
  if (failedChecks.includes("not_specific_to_business")) return "The observation does not feel specific enough to this business.";
  if (failedChecks.includes("not_reply_worthy")) return "The email is unlikely to make the owner curious enough to reply.";
  if (failedChecks.includes("sounds_ai_generated")) return "The email sounds too much like an automated agency email.";
  if (failedChecks.includes("repetitive")) return "The email repeats the same idea in different wording.";
  if (failedChecks.includes("weak_question")) return "The closing question does not feel natural enough.";
  if (failedChecks.includes("word_limit")) return "The email is outside the accepted 100-150 word range.";
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
    weak_question: "weakQuestion",
    word_limit: "wordLimit",
    not_reply_worthy: "notReplyWorthy"
  }[check] || check;
}

function feedbackMessage(check, { wordCount, context }) {
  const hasIndustryContext = Boolean(context.industry || context.businessType);
  return {
    service_mismatch: "Email does not match selected PDF services. Regenerate email.",
    mentions_unselected_services: "The email references services that were not selected for the attached report.",
    missing_report_reference: "The email should mention the attached website opportunity report when report attachment is enabled.",
    word_limit: `The email is ${wordCount} words, but the accepted range is ${EMAIL_WORD_MIN}-${EMAIL_WORD_MAX} words.`,
    generic: "The wording could apply to almost any business.",
    not_personalised: hasIndustryContext
      ? "The email does not reference anything unique about this company's industry, business type, or website."
      : "The email does not reference enough specific detail from the company or website.",
    not_specific_to_observation: "The email does not clearly connect back to the selected observation.",
    not_specific_to_business: "The email does not reference the company in a way that makes it feel written for this business.",
    sounds_ai_generated: "The email contains wording that feels automated, agency-like, or too polished.",
    repetitive: "The email repeats the same idea in different wording.",
    sentence_filler: "One or more sentences do not add clear new information.",
    weak_question: "The closing question feels unnatural, pushy, or asks for more than a simple reply.",
    not_reply_worthy: "The email does not create enough curiosity or business relevance for an owner to reply."
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
  const wordCount = countEmailWords(email.body);
  const serviceDetails = reportContext.selectedServices.length ? serviceMatchDetails(email.body, reportContext) : { matchesSelected: false, mentionsUnselected: false };
  const observationSpecific = hasObservationSpecificity(email.body, observation) || serviceDetails.matchesSelected;

  if (wordCount < EMAIL_WORD_MIN || wordCount > EMAIL_WORD_MAX) failedChecks.push("word_limit");
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
    if (!/attached a short website opportunity report/i.test(email.body)) failedChecks.push("missing_report_reference");
  }

  const commerciallyInteresting = includesAny(email.body, [
    "choose",
    "enquiry",
    "appointment",
    "trust",
    "pricing",
    "first-time visitor",
    "ready to act",
    "remember",
    "decisive",
    "clear"
  ]);
  if (!commerciallyInteresting) failedChecks.push("not_reply_worthy");

  const uniqueFailures = [...new Set(failedChecks)];
  const approved = uniqueFailures.length === 0;
  return {
    approved,
    reason: approved ? "The email feels personal, specific, and human enough to send." : reasonForFailure(uniqueFailures),
    qualityScore: scoreFromFailures(uniqueFailures),
    failedChecks: uniqueFailures,
    feedback: buildFeedback(uniqueFailures, { wordCount, context })
  };
}

const forbiddenPhrases = [
  "audit",
  "analysis",
  "ai",
  "artificial intelligence",
  "consultant",
  "consulting",
  "funnel",
  "cro",
  "user experience",
  "value proposition",
  "marketing",
  "meeting",
  "calendar",
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
