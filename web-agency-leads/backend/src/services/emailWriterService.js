import OpenAI from "openai";
import { SERVICE_EMAIL_ANGLES } from "../constants/serviceEmailAngles.js";
import { EMAIL_WORD_MAX, EMAIL_WORD_MIN, countEmailWords, logEmailWordLimitQa } from "../utils/emailWordLimit.js";
import { HttpError } from "../utils/httpError.js";

const bannedPhrases = [
  "audit",
  "score",
  "analysis",
  "analyzed",
  "analysed",
  "ai",
  "artificial intelligence",
  "ux",
  "user experience",
  "value proposition",
  "website review",
  "consultant",
  "consulting",
  "marketing",
  "recommendation",
  "synergy",
  "growth hack",
  "calendar",
  "meeting",
  "book a call",
  "schedule a call",
  "free consultation",
  "i hope this message finds you well",
  "platforms",
  "enhance user experience",
  "discuss this further",
  "one thing caught my eye",
  "i specialise in",
  "i specialize in",
  "analysing websites",
  "analyzing websites",
  "best regards",
  "next step for an enquiry",
  "small pause",
  "uncertainty",
  "ready to act",
  "revolutionize",
  "game changer"
];
const bannedOpeners = /^(i wanted to|i noticed|one thing caught my eye|it seems|i thought|i figured|worth mentioning|i was reviewing your website)/i;
const placeholderPattern = /\[[^\]]+\]|\byour name\b|\byour company\b/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstName(value) {
  const name = clean(value);
  return name ? name.split(/\s+/)[0] : "";
}

function normalizeObservation(input = {}) {
  const observation = input.selectedObservation || input.observation;
  if (!observation || typeof observation !== "object") throw new HttpError(422, "A single selected observation is required");
  const normalized = {
    id: clean(observation.id),
    title: clean(observation.title),
    description: clean(observation.description),
    category: clean(observation.category),
    expected: clean(observation.expected),
    actual: clean(observation.actual),
    status: clean(observation.status),
    reasoning: clean(observation.reasoning),
    scores: observation.scores && typeof observation.scores === "object" ? observation.scores : null,
    supportingEvidence: Array.isArray(observation.supportingEvidence) ? observation.supportingEvidence.map(clean).filter(Boolean) : [],
    blueprintSection: clean(observation.blueprintSection)
  };
  if (!normalized.id || !normalized.expected || !normalized.actual) {
    throw new HttpError(422, "Selected observation must include id, expected, and actual");
  }
  return normalized;
}

function normalizeInput(input = {}) {
  const company = input.company && typeof input.company === "object" ? input.company : {};
  const contact = input.contact && typeof input.contact === "object" ? input.contact : {};
  const sender = input.sender && typeof input.sender === "object" ? input.sender : {};
  const businessIdentity = input.businessUnderstanding?.businessIdentity || input.phase1?.businessIdentity || {};
  return {
    observation: normalizeObservation(input),
    companyName: clean(company.name || input.companyName || input.lead?.company || "your team"),
    companyWebsite: clean(company.website || input.website || input.lead?.website || ""),
    industry: clean(input.industry || businessIdentity.industry || input.lead?.industry || ""),
    businessType: clean(input.businessType || businessIdentity.businessType || input.lead?.businessType || ""),
    recipientName: clean(contact.firstName || input.recipientName || input.firstName || input.contactName || ""),
    senderName: clean(sender.name || input.senderName || ""),
    senderTitle: clean(sender.title || input.senderTitle || ""),
    senderCompany: clean(sender.company || input.senderCompany || ""),
    reportContext: input.reportContext && typeof input.reportContext === "object" ? input.reportContext : null,
    qualityFeedback: input.qualityFeedback || input.feedback || null,
    failedChecks: Array.isArray(input.failedChecks) ? input.failedChecks.map(clean).filter(Boolean) : [],
    confidenceMode: clean(input.confidenceMode || "")
  };
}

function naturalJoin(values = []) {
  const items = values.map(clean).filter(Boolean);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function stableVariantKey(value = "") {
  return String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function chooseStableVariant(seed, values = []) {
  if (!values.length) return "";
  return values[Math.abs(stableVariantKey(seed)) % values.length];
}

function selectedServices(input = {}) {
  return Array.isArray(input.reportContext?.selectedServices)
    ? input.reportContext.selectedServices
        .map((item) => typeof item === "string" ? { id: item, label: item } : item)
        .filter((item) => item?.id)
    : [];
}

function selectedServiceIds(input = {}) {
  return selectedServices(input).map((item) => item.id).filter(Boolean);
}

function selectedServiceLabels(input = {}) {
  return selectedServices(input).map((item) => clean(item.label || item.id)).filter(Boolean);
}

function selectedAngles(input = {}) {
  return selectedServiceIds(input).map((id) => ({ id, ...(SERVICE_EMAIL_ANGLES[id] || {}) })).filter((item) => item.phrase);
}

function reportFocusAreas(input = {}) {
  return naturalJoin(selectedServiceLabels(input).slice(0, 3));
}

function reportAnglePhrases(input = {}) {
  return naturalJoin(selectedAngles(input).map((item) => item.phrase).slice(0, 3));
}

function reportImprovementPhrases(input = {}) {
  const concise = selectedAngles(input).map((item) => item.improvementPhrase).filter(Boolean);
  if (concise.length) return naturalJoin(concise.slice(0, 2));
  const explicit = Array.isArray(input.reportContext?.topServiceRecommendations)
    ? input.reportContext.topServiceRecommendations.map(clean).filter(Boolean)
    : [];
  return naturalJoin(explicit.slice(0, 2));
}

function reportQuickWin(input = {}, observation = {}) {
  const explicit = Array.isArray(input.reportContext?.topServiceRecommendations)
    ? input.reportContext.topServiceRecommendations.map(clean).filter(Boolean)
    : [];
  if (explicit.length) return explicit[0];
  const serviceWin = selectedAngles(input).flatMap((item) => item.quickWins || []).filter(Boolean)[0];
  return serviceWin || quickWinFromObservation(observation);
}

function quickWinText(value = "") {
  const next = clean(value).replace(/[.]$/, "");
  if (!next) return "";
  if (/^to\b/i.test(next)) return next;
  if (/^(add|make|rewrite|improve|strengthen|clarify|connect|surface|bring|build|create|use|set up|set|track|reduce|turn)\b/i.test(next)) {
    return `to ${next}`;
  }
  return next;
}

function reportPrimaryObservation(input = {}, observation = {}) {
  const ids = selectedServiceIds(input);
  const observationText = clean(`${observation.actual || ""} ${observation.description || ""} ${observation.reasoning || ""} ${observation.title || ""}`).toLowerCase();
  const explicitProblems = Array.isArray(input.reportContext?.topServiceProblems)
    ? input.reportContext.topServiceProblems.map(clean).filter(Boolean)
    : [];
  if (ids.includes("website_redesign") && ids.includes("seo") && ids.includes("lead_generation")) {
    return "the site has a lot of service paths, but the strongest offer, local relevance, and main contact route could be clearer";
  }
  if (ids.includes("lead_generation") && ids.includes("whatsapp_automation")) {
    return "visitors who are interested may not have a very guided path to ask a question, get qualified, or take the next step";
  }
  if (explicitProblems.length) {
    const firstProblem = explicitProblems[0]
      .replace(/^the business may /i, "")
      .replace(/^potential customers may /i, "")
      .replace(/^visitors may /i, "")
      .replace(/[.]$/g, "");
    if (firstProblem) return firstProblem.charAt(0).toLowerCase() + firstProblem.slice(1);
  }
  if (/service-like links|service links|many service/.test(observationText)) {
    return ids.includes("seo") || ids.includes("website_redesign") || ids.includes("lead_generation")
      ? "the service structure is broad, but the main offer and contact path could be clearer"
      : "the site could guide people toward the most important next step more clearly";
  }
  const primaryAngle = selectedAngles(input)[0];
  if (primaryAngle?.observation) return primaryAngle.observation;
  return clean(observation.actual || observation.description || observation.title).replace(/[.]$/, "");
}

function reportBusinessOutcome(input = {}, observation = {}) {
  const primaryAngle = selectedAngles(input)[0];
  if (primaryAngle?.outcome) return primaryAngle.outcome;
  const combined = clean(`${observation.expected || ""} ${observation.actual || ""} ${observation.description || ""}`).toLowerCase();
  if (/book|appointment/.test(combined)) return "book or enquire without extra friction";
  if (/contact|form|whatsapp|lead/.test(combined)) return "get in touch quickly";
  if (/search|seo|location/.test(combined)) return "find the right page through search";
  return "understand the offer and take the next step";
}

function reportSummary(input = {}) {
  return clean(input.reportContext?.reportSummary || "");
}

function technicalObservationWarning(text = "") {
  return /\b(service-like links|detector|crawler|confidence score|opportunity score)\b/i.test(text);
}

function quickWinFromObservation(observation = {}) {
  const combined = clean(`${observation.expected || ""} ${observation.actual || ""} ${observation.description || ""} ${observation.reasoning || ""} ${observation.category || ""}`).toLowerCase();
  if (/home|homepage|hero|above.?fold/.test(combined)) return "making the homepage message and main CTA clearer above the fold";
  if (/book|booking|appointment/.test(combined)) return "making the booking CTA easier to find, especially on mobile";
  if (/contact|form|whatsapp|enquir|inquir/.test(combined)) return "making the contact path easier to spot without extra scrolling";
  if (/review|testimonial|trust|credib/.test(combined)) return "bringing trust signals closer to the main contact action";
  if (/mobile/.test(combined)) return "making the primary action easier to use on mobile";
  return "making the main next step clearer for interested visitors";
}

function businessPhrase(input = {}) {
  const label = clean(input.businessType || input.industry || "").toLowerCase();
  if (!label) return "a business like this";
  if (label === "dental") return "a dental clinic";
  if (label === "medical") return "a medical clinic";
  if (label === "legal") return "a law firm";
  if (label === "restaurant") return "a restaurant";
  const article = /^[aeiou]/.test(label) ? "an" : "a";
  return `${article} ${label}`;
}

function comparisonNoun(input = {}) {
  const suppliedContext = clean(input.businessType || input.industry || "");
  const context = clean(`${input.businessType || ""} ${input.industry || ""}`).toLowerCase();
  if (!context) return "";
  if (/marine.*fuel|fuel.*marine|bunker/.test(context)) return "other marine fuel suppliers";
  if (/fuel|energy supplier|oil|gas|petroleum/.test(context)) return "other fuel suppliers";
  if (/logistics|freight|shipping|transport|courier|warehouse/.test(context)) return "other logistics providers";
  if (/accounting|accountant|bookkeeping|tax|audit firm/.test(context)) return "other accounting firms";
  if (/dental|dentist|orthodont/.test(context)) return "other dental clinics";
  if (/medical|clinic|healthcare|doctor|physician|patient/.test(context)) return "other clinics";
  if (/legal|law firm|lawyer|attorney|solicitor/.test(context)) return "other law firms";
  if (/restaurant|cafe|food|bar|bistro/.test(context)) return "other restaurants";
  if (/interior|architecture|design studio/.test(context)) return "other design studios";
  if (/home service|contractor|plumb|electric|roof|hvac|renovation/.test(context)) return "other service providers";
  return suppliedContext ? `other ${pluralizeBusinessTerm(suppliedContext)}` : "";
}

function pluralizeBusinessTerm(value) {
  const text = clean(value).toLowerCase();
  if (!text) return "";
  if (/s$/.test(text)) return text;
  if (/company$/.test(text)) return text.replace(/company$/, "companies");
  if (/clinic$/.test(text)) return `${text}s`;
  if (/firm$/.test(text)) return `${text}s`;
  if (/supplier$/.test(text)) return `${text}s`;
  if (/provider$/.test(text)) return `${text}s`;
  if (/studio$/.test(text)) return `${text}s`;
  if (/agency$/.test(text)) return text.replace(/agency$/, "agencies");
  return `${text}s`;
}

function businessContextPhrase(input = {}) {
  const label = clean(input.businessType || input.industry || "").toLowerCase();
  if (!label) return "";
  const singular = singularBusinessTerm(label);
  const article = /^[aeiou]/.test(singular) ? "an" : "a";
  return `${article} ${singular}`;
}

function singularBusinessTerm(value) {
  const text = clean(value).toLowerCase();
  if (/clinics$/.test(text)) return text.replace(/clinics$/, "clinic");
  if (/companies$/.test(text)) return text.replace(/companies$/, "company");
  if (/agencies$/.test(text)) return text.replace(/agencies$/, "agency");
  if (/(suppliers|providers|firms|restaurants|studios)$/.test(text)) return text.replace(/s$/, "");
  return text;
}

function observationEvidenceText(observation = {}) {
  return clean([
    observation.actual,
    observation.description,
    observation.reasoning,
    Array.isArray(observation.supportingEvidence) ? observation.supportingEvidence.join(" ") : "",
    observation.title,
    observation.expected,
    observation.category
  ].join(" "));
}

function isMediumConfidence(input = {}, observation = {}) {
  return input.confidenceMode === "medium_confidence" ||
    (Number(observation.confidence) >= 0.6 && Number(observation.confidence) < 0.85);
}

function uncertaintyPrefix(input, observation) {
  return isMediumConfidence(input, observation) ? "I may be mistaken, but " : "";
}

function evidenceHasPresentBooking(evidenceText) {
  return /\b(book|booking|appointment|schedule|reserve|reservation)\b/i.test(evidenceText) &&
    !/\b(no|not|none|missing|absent|could not find|did not show|unclear)\b/i.test(evidenceText);
}

function evidenceBasisFromObservation(observation = {}) {
  return clean(observation.actual || observation.reasoning || observation.description || arrayText(observation.supportingEvidence) || observation.title);
}

function arrayText(value) {
  return Array.isArray(value) ? value.join(" ") : "";
}

function visitorExperienceFromObservation(observation, input = {}) {
  const evidenceText = observationEvidenceText(observation);
  const combined = clean(`${evidenceText} ${observation.status}`).toLowerCase();
  const specificComparison = comparisonNoun(input);
  const comparison = specificComparison || "similar options";
  const company = input.companyName && input.companyName !== "your team" ? input.companyName : "the company";
  const confidence = isMediumConfidence(input, observation) ? "medium" : observationConfidenceBand(observation);
  const cautious = confidence === "medium" ? "I may be mistaken, but " : "";

  if (/value proposition|different|differentiat|why choose|positioning/.test(combined)) {
    return {
      goal: `get a quick feel for ${company}`,
      experience: `${cautious}after a minute or two, I still wasn't sure what would make someone choose ${company} over ${comparison}`,
      evidenceBasis: evidenceBasisFromObservation(observation),
      confidence
    };
  }

  if (/book|booking|appointment|enquir|inquir|contact|cta|next step|form/.test(combined)) {
    const context = businessContextPhrase(input);
    if (evidenceHasPresentBooking(evidenceText) || observation.status === "partial") {
      return {
        goal: evidenceHasPresentBooking(evidenceText) ? "book an appointment" : "find the easiest contact option",
        experience: `${cautious}${context ? `for ${context}, ` : ""}I had to look twice before the contact option stood out`,
        evidenceBasis: evidenceBasisFromObservation(observation),
        confidence
      };
    }
    return {
      goal: "find contact details",
      experience: `${cautious}${context ? `for ${context}, ` : ""}I couldn't immediately spot a phone number or obvious way to get in touch without clicking around`,
      evidenceBasis: evidenceBasisFromObservation(observation),
      confidence
    };
  }

  if (/trust|certification|credential|review|testimonial|proof|why choose|case stud/.test(combined)) {
    return {
      goal: `understand why someone should trust ${company}`,
      experience: `${cautious}I wasn't completely sure what would reassure someone choosing between ${specificComparison || "a few options"}`,
      evidenceBasis: evidenceBasisFromObservation(observation),
      confidence
    };
  }

  if (/pricing|cost|fee|package|quote/.test(combined)) {
    return {
      goal: "get a rough sense of cost before reaching out",
      experience: `${cautious}I couldn't quickly tell what kind of budget or price range to expect`,
      evidenceBasis: evidenceBasisFromObservation(observation),
      confidence
    };
  }

  if (/mobile|phone/.test(combined)) {
    return {
      goal: "check the site quickly on a phone",
      experience: `${cautious}I wasn't sure where I would tap first without spending more time on the page`,
      evidenceBasis: evidenceBasisFromObservation(observation),
      confidence
    };
  }

  return {
    goal: "understand the page quickly",
    experience: `${cautious}${clean(observation.actual || observation.description || "one part of the page")} wasn't as easy to make sense of as I expected`,
    evidenceBasis: evidenceBasisFromObservation(observation),
    confidence
  };
}

function observationConfidenceBand(observation = {}) {
  const confidence = Number(observation.confidence);
  if (Number.isFinite(confidence)) {
    if (confidence >= 0.85) return "high";
    if (confidence >= 0.6) return "medium";
    return "low";
  }
  return "high";
}

function insightSentenceFromVisitorExperience(visitorExperience) {
  return `I tried to ${visitorExperience.goal}, and ${visitorExperience.experience}.`;
}

function openerFor(input) {
  const company = input.companyName === "your team" ? "your site" : input.companyName;
  const website = input.companyWebsite ? "your website" : "your company";
  return input.companyName === "your team"
    ? `I spent a few minutes on ${website} earlier.`
    : `I spent a few minutes on the ${company} website earlier.`;
}

function extraVisitorContextFromInsight(insight) {
  const text = clean(insight).toLowerCase();
  if (/differen|choose/.test(text)) {
    return "That can matter because people often make a quick judgement before they read deeply.";
  }
  if (/enquire|next step|appointment|booking|contact/.test(text)) {
    return "That can matter when someone is trying to decide whether to keep browsing or get in touch.";
  }
  if (/pricing|cost/.test(text)) {
    return "For someone comparing options, that context can shape whether they feel ready to reach out.";
  }
  if (/mobile/.test(text)) {
    return "For someone checking quickly on their phone, that clarity can change whether they keep going.";
  }
  return "That small bit of context can make the business easier to understand and remember.";
}

function lowFrictionQuestion(observation) {
  const combined = clean(`${observation.expected} ${observation.actual} ${observation.category}`).toLowerCase();
  if (/booking|appointment|contact|enquir|inquir/.test(combined)) return "Would it be useful if I showed what a cleaner version of this flow could look like?";
  return chooseStableVariant(combined, [
    "Would it be okay if I sent over a few suggestions on how we would improve this?",
    "Would you be open to me sharing a few ideas on how this could be improved?",
    "Happy to send over a quick breakdown if this is something you are looking at improving."
  ]);
}

function fallbackEmail(input) {
  const { observation, companyName, recipientName } = input;
  const greeting = firstName(recipientName) ? `Hi ${firstName(recipientName)},` : "Hi there,";
  const serviceAngle = reportAnglePhrases(input);
  const opener = serviceAngle
    ? `I spent a few minutes reviewing the ${companyName} website and noticed a few opportunities around ${serviceAngle}.`
    : `I spent a few minutes reviewing the ${companyName} website and noticed that ${reportPrimaryObservation(input, observation)}.`;
  const businessProblem = `The main thing that stood out was that ${reportPrimaryObservation(input, observation)}. For ${businessPhrase(input)}, this could make it harder for people to ${reportBusinessOutcome(input, observation)}.`;
  const reportSentence = input.reportContext
    ? `I attached a short website opportunity report covering ${reportFocusAreas(input)} with a few specific suggestions around ${reportImprovementPhrases(input)}.`
    : "";
  const quickWin = `One quick win would be ${quickWinText(reportQuickWin(input, observation))}.`;
  const question = lowFrictionQuestion(observation);
  const body = [
    greeting,
    "",
    opener,
    "",
    businessProblem,
    "",
    reportSentence || null,
    reportSentence ? "" : null,
    quickWin,
    "",
    question,
    "",
    "Thanks,",
    firstName(input.senderName) || signoffFor(input)
  ].filter((line) => line !== null).join("\n");
  return {
    subject: subjectFor(input),
    body: cleanEmailBody(body)
  };
}

function signoffFor(input = {}) {
  return signatureFor(input);
}

function signatureFor(input = {}) {
  const name = clean(input.senderName);
  const title = clean(input.senderTitle);
  const company = clean(input.senderCompany);
  const secondLine = [title, company].filter(Boolean).join(", ");
  return [name, secondLine].filter(Boolean).join("\n");
}

function subjectFor(input = {}) {
  const company = input.companyName && input.companyName !== "your team" ? input.companyName : "";
  const serviceIds = selectedServiceIds(input);
  if (serviceIds.includes("appointment_booking")) return "Quick idea for your booking flow";
  if (serviceIds.includes("whatsapp_automation")) return "Quick idea for your enquiry flow";
  if (serviceIds.includes("lead_generation")) return "Quick idea for your contact flow";
  if (serviceIds.includes("website_redesign")) return company ? `Quick thought on ${company}` : "Quick thought on your homepage";
  const combined = clean(`${input.observation?.title || ""} ${input.observation?.expected || ""} ${input.observation?.actual || ""}`).toLowerCase();
  if (company) return chooseStableVariant(company, [`Quick thought on ${company}`, `Small website suggestion for ${company}`, `Website improvement idea for ${company}`]);
  return "Small question about your website";
}

function cleanEmailBody(value) {
  return String(value || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function insertLengthGuardSentence(body, sentence) {
  const cleanBody = cleanEmailBody(body);
  const cleanSentence = clean(sentence);
  const closingQuestions = [
    "Would it be okay if I sent over a few suggestions on how we would improve this?",
    "Would you be open to me sharing a few ideas on how this could be improved?",
    "Happy to send over a quick breakdown if this is something you are looking at improving.",
    "Would it be useful if I showed what a cleaner version of this flow could look like?"
  ];
  for (const question of closingQuestions) {
    if (cleanBody.includes(question)) {
      return cleanEmailBody(cleanBody.replace(question, `${cleanSentence}\n\n${question}`));
    }
  }
  return cleanEmailBody(`${cleanBody}\n\n${cleanSentence}`);
}

function ensureMinimumEmailLength(email, input, source) {
  const body = cleanEmailBody(email.body || email.emailBody || email.fullMessage);
  const initialCount = countEmailWords(body);
  if (initialCount >= EMAIL_WORD_MIN) return { ...email, body };

  const visitorExperience = visitorExperienceFromObservation(input.observation, input);
  const insight = insightSentenceFromVisitorExperience(visitorExperience);
  const paddedBody = insertLengthGuardSentence(body, extraVisitorContextFromInsight(insight));
  const paddedCount = countEmailWords(paddedBody);
  console.info("[email-length-padding]", JSON.stringify({
    source,
    initialWordCount: initialCount,
    paddedWordCount: paddedCount,
    minimum: EMAIL_WORD_MIN,
    maximum: EMAIL_WORD_MAX
  }));
  return { ...email, body: paddedBody };
}

function ensureMaximumEmailLength(email, input, source) {
  let body = cleanEmailBody(email.body || email.emailBody || email.fullMessage);
  let count = countEmailWords(body);
  if (count <= EMAIL_WORD_MAX) return { ...email, body };

  const compactReportSentence = input.reportContext
    ? `I attached a short website opportunity report covering ${reportFocusAreas(input)}.`
    : "";
  if (compactReportSentence) {
    body = body.replace(
      /I attached a short website opportunity report covering[\s\S]*?(?=\n\n(?:One quick win|A quick win|Would it))/i,
      `${compactReportSentence}\n\n`
    );
    count = countEmailWords(body);
  }

  if (count > EMAIL_WORD_MAX) {
    body = body.replace(/One quick win would be /i, "A quick win would be ");
    count = countEmailWords(body);
  }

  console.info("[email-length-tighten]", JSON.stringify({
    source,
    tightenedWordCount: count,
    minimum: EMAIL_WORD_MIN,
    maximum: EMAIL_WORD_MAX
  }));
  return { ...email, body: cleanEmailBody(body) };
}

function hasBannedLanguage(value) {
  const text = clean(value).toLowerCase();
  if (placeholderPattern.test(value)) return true;
  if (bannedOpeners.test(cleanEmailBody(value))) return true;
  if (technicalObservationWarning(value)) return true;
  return bannedPhrases.some((phrase) => {
    if (phrase === "ai") return /\bai\b/.test(text);
    return text.includes(phrase);
  });
}

function hasLabels(value) {
  return /^(subject|insight|observation|cta|pitch|opener|body)\s*:/im.test(value);
}

function validateEmail(email, observation, input = {}, source = "unknown") {
  const body = cleanEmailBody(email.body || email.emailBody || email.fullMessage);
  const subject = clean(email.subject || "");
  const wordLimit = logEmailWordLimitQa(`phase8-email-writer:${source}`, body);
  const subjectIsOnlyCompany = subject && subject.toLowerCase() === clean(input.companyName || "").toLowerCase();
  return {
    ok: Boolean(subject && body && wordLimit.withinWordLimit && !subjectIsOnlyCompany && !hasBannedLanguage(`${subject}\n${body}`) && !hasLabels(body)),
    subject,
    body,
    wordCount: wordLimit.wordCount,
    diagnostics: {
      hasSubject: Boolean(subject),
      hasBody: Boolean(body),
      calculatedWordCount: wordLimit.wordCount,
      minimum: EMAIL_WORD_MIN,
      maximum: EMAIL_WORD_MAX,
      withinWordLimit: wordLimit.withinWordLimit,
      subjectIsOnlyCompany,
      hasBannedLanguage: hasBannedLanguage(`${subject}\n${body}`),
      hasLabels: hasLabels(body)
    }
  };
}

function buildPrompt(input) {
  const serviceLabels = selectedServiceLabels(input);
  const serviceAngle = reportAnglePhrases(input);
  const serviceObservation = reportPrimaryObservation(input, input.observation);
  const serviceOutcome = reportBusinessOutcome(input, input.observation);
  const quickWin = quickWinText(reportQuickWin(input, input.observation));
  const opener = serviceAngle
    ? `I spent a few minutes reviewing the ${input.companyName} website and noticed a few opportunities around ${serviceAngle}.`
    : `I spent a few minutes reviewing the ${input.companyName} website and noticed that ${serviceObservation}.`;
  const question = lowFrictionQuestion(input.observation);
  const signature = signatureFor(input);
  const reportSentence = input.reportContext
    ? `I attached a short website opportunity report covering ${reportFocusAreas(input)} with a few specific suggestions around ${reportImprovementPhrases(input)}.`
    : "";
  const feedbackBlock = input.qualityFeedback || input.failedChecks.length
    ? `\nPrevious quality gate feedback to avoid this time. Do not mention this feedback in the email:\nFailed checks: ${JSON.stringify(input.failedChecks || [])}\nFeedback: ${JSON.stringify(input.qualityFeedback || {}, null, 2)}\n`
    : "";
  return `Write one natural first email.

You are NOT discovering observations.
You are NOT scoring observations.
You are NOT selecting observations.
The observation has already been chosen.

Selected report services:
${JSON.stringify(serviceLabels, null, 2)}

Selected service phrases:
"${serviceAngle || "not provided"}"

Report summary:
"${reportSummary(input) || "not provided"}"

Top service problems:
${JSON.stringify(input.reportContext?.topServiceProblems || [], null, 2)}

Top service recommendations:
${JSON.stringify(input.reportContext?.topServiceRecommendations || [], null, 2)}

Natural opener:
"${opener}"

Soft question to end with:
"${question}"
${feedbackBlock}

The original observation is included only so you avoid inventing anything. Translate it into business language tied to the selected services. Do not quote its title or audit wording:
${JSON.stringify(input.observation, null, 2)}

Company: ${input.companyName}
Recipient first name, if known: ${firstName(input.recipientName) || "unknown"}
${signature ? `Signature must be exactly:\n${signature}` : "No sender signature was supplied. Do not invent or include one."}

Rules:
- 100 to 150 words.
- If the draft is under 100 words, add one natural business-context sentence before the final CTA.
- Natural and conversational.
- Sounds like one professional writing to another.
- The email must match the selected PDF report services only.
- Do not mention services that were not selected.
- Translate technical observation language into business language.
- The main observation should align with this business-facing angle: "${serviceObservation}".
- The business outcome should align with: "${serviceOutcome}".
- Use normal email formatting: greeting, body, low-pressure CTA, "Thanks,", then the supplied signature.
- Never contradict the supplied evidence. If evidence is ambiguous or confidence is medium, use cautious language rather than an absolute claim.
- State the core insight only once.
- Every sentence must add new information.
- Subject must not be only the company name.
- Good subject examples: Quick question about your homepage, Quick thought on ${input.companyName}, Small question about your website.
- No labels or headings.
- No consultant language.
- No AI language.
- No marketing buzzwords.
- No fake compliments.
- No exaggerated claims.
- No meetings or calendar links.
- No "discuss this further" phrasing.
- Do not use these phrases: partially detected, missing, observation, UX, user experience, website review, consultant, marketing, recommendation.
- Do not use these phrases: 13 service-like links were found, the detector found, the crawler observed, confidence score, opportunity score.
- Avoid openings like: I wanted to, I noticed, One thing caught my eye, It seems, I thought, I figured, Worth mentioning, I was reviewing your website.
- No placeholders.
- Do not write "I hope this message finds you well."
- Do not use "Best regards."
- Do not say "this space" when industry context is available.
- No hard sell.
- Mention one specific observation only, but frame it through the selected service angle.
- Explain the business problem behind it in a calm way.
- ${input.reportContext ? "Mention the attached report exactly once." : "Do not mention any report or attachment."}
- Include one specific quick win connected to the selected services. Prefer this quick win angle: "${quickWin}".
- Use the supplied opener, then one business-problem sentence, ${input.reportContext ? "the report sentence, " : ""}one quick-win sentence, one soft CTA, and the supplied signature. Add a short context sentence only if needed to meet the word limit.
- Do not invent why you found the company.
- End with the supplied low-friction CTA.
- Do not mention audits, scores, analyses, or recommendations.
- Do not introduce any new observations.

Return strict JSON only:
{
  "subject": "",
  "body": ""
}`;
}

async function writeWithOpenAI(input) {
  if (!process.env.OPENAI_API_KEY) return null;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You write restrained, natural first emails that must match the selected PDF report services. Use only the supplied evidence, selected services, report summary, and service problems. Return strict JSON. Do not invent facts or mention technical detector language."
      },
      { role: "user", content: buildPrompt(input) }
    ],
    temperature: 0.35
  });
  return JSON.parse(response.choices[0]?.message?.content || "{}");
}

export async function writeEmail(input = {}) {
  const normalized = normalizeInput(input);
  const generated = await writeWithOpenAI(normalized).catch(() => null);
  const generatedWithLengthGuard = generated ? ensureMaximumEmailLength(ensureMinimumEmailLength(generated, normalized, "openai"), normalized, "openai") : null;
  const validated = generatedWithLengthGuard ? validateEmail(generatedWithLengthGuard, normalized.observation, normalized, "openai") : { ok: false };
  const fallbackWithLengthGuard = ensureMaximumEmailLength(ensureMinimumEmailLength(fallbackEmail(normalized), normalized, "fallback"), normalized, "fallback");
  const email = validated.ok ? validated : validateEmail(fallbackWithLengthGuard, normalized.observation, normalized, "fallback");
  if (!email.ok) throw new HttpError(422, "Could not create a compliant email from the selected observation", email.diagnostics);
  return {
    selectedObservationId: normalized.observation.id,
    subject: email.subject,
    body: email.body,
    wordCount: email.wordCount,
    emailSelectedServices: selectedServiceIds(normalized)
  };
}
