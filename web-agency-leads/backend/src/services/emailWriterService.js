import OpenAI from "openai";
import { EMAIL_WORD_MAX, EMAIL_WORD_MIN, countEmailWords, logEmailWordLimitQa } from "../utils/emailWordLimit.js";
import { HttpError } from "../utils/httpError.js";

const bannedPhrases = [
  "audit",
  "report",
  "score",
  "analysis",
  "analyzed",
  "analysed",
  "ai",
  "artificial intelligence",
  "optimisation",
  "optimization",
  "conversion",
  "funnel",
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
  "visitors",
  "enquiry flow",
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
    qualityFeedback: input.qualityFeedback || input.feedback || null,
    failedChecks: Array.isArray(input.failedChecks) ? input.failedChecks.map(clean).filter(Boolean) : [],
    confidenceMode: clean(input.confidenceMode || "")
  };
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
  if (/feedback|review|testimonial/.test(combined)) return "Curious if you have ever had similar feedback.";
  if (/priority|pricing|cost/.test(combined)) return "Or has it just never been a priority?";
  return "Was that intentional?";
}

function fallbackEmail(input) {
  const { observation, companyName, recipientName } = input;
  const greeting = firstName(recipientName) ? `Hi ${firstName(recipientName)},` : "Hi there,";
  const visitorExperience = visitorExperienceFromObservation(observation, input);
  const insight = insightSentenceFromVisitorExperience(visitorExperience);
  const opener = openerFor(input);
  const question = lowFrictionQuestion(observation);
  const signoff = signoffFor(input);
  const body = [
    greeting,
    "",
    opener,
    "",
    insight,
    "",
    question,
    "",
    "Thanks,",
    signoff
  ].join("\n");
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
  const combined = clean(`${input.observation?.title || ""} ${input.observation?.expected || ""} ${input.observation?.actual || ""}`).toLowerCase();
  if (/home|homepage|hero|above.?fold/.test(combined)) return "Quick question about your homepage";
  if (company) return `Quick thought on ${company}`;
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
    "Was that intentional?",
    "Or has it just never been a priority?",
    "Curious if you have ever had similar feedback."
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

function hasBannedLanguage(value) {
  const text = clean(value).toLowerCase();
  if (placeholderPattern.test(value)) return true;
  if (bannedOpeners.test(cleanEmailBody(value))) return true;
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
  const visitorExperience = visitorExperienceFromObservation(input.observation, input);
  const humanInsight = insightSentenceFromVisitorExperience(visitorExperience);
  const opener = openerFor(input);
  const question = lowFrictionQuestion(input.observation);
  const signature = signatureFor(input);
  const feedbackBlock = input.qualityFeedback || input.failedChecks.length
    ? `\nPrevious quality gate feedback to avoid this time. Do not mention this feedback in the email:\nFailed checks: ${JSON.stringify(input.failedChecks || [])}\nFeedback: ${JSON.stringify(input.qualityFeedback || {}, null, 2)}\n`
    : "";
  return `Write one natural first email.

You are NOT discovering observations.
You are NOT scoring observations.
You are NOT selecting observations.
The observation has already been chosen.

Internal visitorExperience object:
${JSON.stringify(visitorExperience, null, 2)}

Single insight sentence to write from:
"${humanInsight}"

Natural opener:
"${opener}"

Soft question to end with:
"${question}"
${feedbackBlock}

The original observation is included only so you avoid inventing anything. Do not quote its title or audit wording:
${JSON.stringify(input.observation, null, 2)}

Company: ${input.companyName}
Recipient first name, if known: ${firstName(input.recipientName) || "unknown"}
${signature ? `Signature must be exactly:\n${signature}` : "No sender signature was supplied. Do not invent or include one."}

Rules:
- 45 to 120 words.
- If the draft is under 45 words, add one natural visitor-context sentence before the final question.
- Natural and conversational.
- Sounds like one professional writing to another.
- Derive the insight primarily from actual evidence, supporting evidence, and reasoning. Use the observation title only as a last resort.
- Write from the visitorExperience object, not from blueprint titles or internal labels.
- Use normal email formatting: greeting, body, question, "Thanks,", then the supplied signature.
- Never contradict the supplied evidence. If evidence is ambiguous or confidence is medium, use cautious language rather than an absolute claim.
- State the core insight only once.
- Every sentence must add new information.
- Prefer a shorter email when the insight is simple.
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
- Do not use these phrases: partially detected, missing, observation, optimisation, conversion, funnel, UX, user experience, value proposition, website review, consultant, marketing, recommendation.
- Do not use these phrases: next step for an enquiry, small pause, uncertainty, ready to act, visitors, enquiry flow.
- Avoid openings like: I wanted to, I noticed, One thing caught my eye, It seems, I thought, I figured, Worth mentioning, I was reviewing your website.
- No placeholders.
- Do not write "I hope this message finds you well."
- Do not use "Best regards."
- Do not say "this space" when industry context is available.
- No hard sell.
- Do not pitch services.
- Use the supplied opener, then one insight sentence, one simple question, and the supplied signature only. Add a short context sentence only if needed to meet the word limit.
- Do not invent why you found the company.
- End with the supplied low-friction question.
- Do not mention audits, reports, scores, analyses, or recommendations.
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
        content: "You write restrained, natural first emails from one supplied observation only. Return strict JSON. Do not invent facts."
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
  const generatedWithLengthGuard = generated ? ensureMinimumEmailLength(generated, normalized, "openai") : null;
  const validated = generatedWithLengthGuard ? validateEmail(generatedWithLengthGuard, normalized.observation, normalized, "openai") : { ok: false };
  const fallbackWithLengthGuard = ensureMinimumEmailLength(fallbackEmail(normalized), normalized, "fallback");
  const email = validated.ok ? validated : validateEmail(fallbackWithLengthGuard, normalized.observation, normalized, "fallback");
  if (!email.ok) throw new HttpError(422, "Could not create a compliant email from the selected observation", email.diagnostics);
  return {
    selectedObservationId: normalized.observation.id,
    subject: email.subject,
    body: email.body,
    wordCount: email.wordCount
  };
}
