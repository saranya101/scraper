import { HttpError } from "../utils/httpError.js";

const observationCategories = new Set([
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
const statuses = new Set(["present", "partial", "absent", "unclear", "exceeds_expectation"]);
const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "clear",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "page",
  "pages",
  "section",
  "site",
  "the",
  "to",
  "website",
  "with"
]);
const sectionCategoryMap = {
  primaryGoal: "Conversion",
  secondaryGoals: "Conversion",
  customerJourney: "User Experience",
  "informationArchitecture.criticalPages": "Navigation",
  "informationArchitecture.recommendedPages": "Navigation",
  "informationArchitecture.pagePriority": "Navigation",
  "conversionArchitecture.primaryCTA": "Conversion",
  "conversionArchitecture.secondaryCTAs": "Conversion",
  "conversionArchitecture.conversionFlow": "Conversion",
  "conversionArchitecture.expectedFrictionPoints": "User Experience",
  "trustArchitecture.requiredTrustSignals": "Trust",
  "trustArchitecture.idealPlacement": "Trust",
  "trustArchitecture.proofHierarchy": "Proof",
  "contentArchitecture.servicePages": "Services",
  "contentArchitecture.educationalContent": "Content",
  "contentArchitecture.faqTopics": "Decision Support",
  "contentArchitecture.comparisonContent": "Decision Support",
  "decisionSupport.questionsToAnswer": "Decision Support",
  "decisionSupport.objectionsToHandle": "Decision Support",
  "decisionSupport.decisionTriggers": "Decision Support",
  localSEOExpectations: "Local",
  technicalExpectations: "Technical",
  mobileExpectations: "Mobile",
  userExperiencePrinciples: "User Experience",
  "visualHierarchy.heroPurpose": "User Experience",
  "visualHierarchy.aboveFoldContent": "User Experience",
  "visualHierarchy.trustPlacement": "Trust",
  "visualHierarchy.ctaPlacement": "Conversion"
};
const evidenceCategoryMap = {
  business: "Content",
  trust: "Trust",
  conversion: "Conversion",
  services: "Services",
  content: "Content",
  navigation: "Navigation",
  social_proof: "Social Proof",
  credentials: "Proof",
  contact: "Conversion",
  local: "Local",
  technical: "Technical",
  seo: "SEO",
  ux: "User Experience"
};
const seoMetaSections = new Set(["localSEOExpectations", "technicalExpectations"]);
const categoryAllowedEvidence = {
  Trust: new Set(["Trust", "Proof", "Social Proof"]),
  Conversion: new Set(["Conversion"]),
  Navigation: new Set(["Navigation", "Content"]),
  Content: new Set(["Content", "Services"]),
  Services: new Set(["Services"]),
  "Decision Support": new Set(["Content"]),
  Proof: new Set(["Proof", "Trust"]),
  "Social Proof": new Set(["Social Proof"]),
  Pricing: new Set(["Pricing"]),
  Booking: new Set(["Conversion"]),
  Local: new Set(["Local"]),
  SEO: new Set(["SEO"]),
  Technical: new Set(["Technical"]),
  "User Experience": new Set(["User Experience", "Conversion", "Navigation", "Content"]),
  Mobile: new Set(["Mobile", "User Experience"])
};
const blockedEvidenceText = /\b(wp-content|\.css\b|\.js\b|plugin|elementor)\b/i;
const noisyBusinessEvidenceText = /\b(continue reading|skip to content|got questions\??)\b/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactIdPart(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function words(value) {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function textForMatching(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[_-]/g, " ");
}

function tokenOverlap(a, b) {
  const aWords = new Set(words(a));
  const bWords = new Set(words(b));
  if (!aWords.size || !bWords.size) return 0;
  let matches = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) matches += 1;
  });
  return matches / Math.max(1, Math.min(aWords.size, bWords.size));
}

function normalizeBlueprint(input = {}) {
  let blueprint = input.websiteBlueprint || input.blueprint?.websiteBlueprint || input.blueprint || {};
  if (blueprint.websiteBlueprint) blueprint = blueprint.websiteBlueprint;
  if (!blueprint || typeof blueprint !== "object" || !Object.keys(blueprint).length) {
    throw new HttpError(422, "Website Blueprint is required");
  }
  return blueprint;
}

function normalizeEvidence(input = {}) {
  const rawEvidence = input.structuredEvidence?.structuredEvidence || input.evidence?.structuredEvidence || input.structuredEvidence || [];
  const evidence = array(rawEvidence)
    .map((item, index) => {
      const id = clean(item.id || `evidence-${index + 1}`);
      const evidenceText = clean(item.evidenceText || item.ocrEvidence || item.domSelector);
      const signal = clean(item.signal);
      const text = clean(`${signal} ${item.evidenceText || ""} ${item.ocrEvidence || ""} ${array(item.notes).join(" ")}`);
      return {
        id,
        signal,
        status: clean(item.status || "unclear"),
        category: clean(item.category),
        mappedCategory: evidenceCategoryMap[clean(item.category)] || "Content",
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.5,
        evidenceText,
        isMetaEvidence: /^meta_(title|description)$/.test(signal) || /^meta-(title|description)$/.test(id),
        isFaqEvidence: isRealFaqEvidence(signal, evidenceText),
        text
      };
    })
    .filter((item) => item.id && item.evidenceText)
    .filter((item) => !blockedEvidenceText.test(`${item.evidenceText} ${item.text}`))
    .filter((item) => !noisyBusinessEvidenceText.test(item.evidenceText));

  if (!evidence.length) throw new HttpError(422, "Structured Evidence with evidence items is required");
  return evidence;
}

function addExpectation(expectations, section, value, index = 0) {
  const text = clean(value);
  if (!text) return;
  const category = sectionCategoryMap[section] || "Content";
  expectations.push({
    id: `bp-${compactIdPart(section)}-${index + 1}-${compactIdPart(text)}`,
    text,
    section,
    category
  });
}

function flattenBlueprint(blueprint) {
  const expectations = [];
  addExpectation(expectations, "primaryGoal", blueprint.primaryGoal);
  array(blueprint.secondaryGoals).forEach((item, index) => addExpectation(expectations, "secondaryGoals", item, index));
  array(blueprint.customerJourney).forEach((item, index) => addExpectation(expectations, "customerJourney", item, index));

  const ia = object(blueprint.informationArchitecture);
  array(ia.criticalPages).forEach((item, index) => addExpectation(expectations, "informationArchitecture.criticalPages", item, index));
  array(ia.recommendedPages).forEach((item, index) => addExpectation(expectations, "informationArchitecture.recommendedPages", item, index));
  array(ia.pagePriority).forEach((item, index) => addExpectation(expectations, "informationArchitecture.pagePriority", item, index));

  const conversion = object(blueprint.conversionArchitecture);
  addExpectation(expectations, "conversionArchitecture.primaryCTA", conversion.primaryCTA);
  array(conversion.secondaryCTAs).forEach((item, index) => addExpectation(expectations, "conversionArchitecture.secondaryCTAs", item, index));
  array(conversion.conversionFlow).forEach((item, index) => addExpectation(expectations, "conversionArchitecture.conversionFlow", item, index));
  array(conversion.expectedFrictionPoints).forEach((item, index) => addExpectation(expectations, "conversionArchitecture.expectedFrictionPoints", item, index));

  const trust = object(blueprint.trustArchitecture);
  array(trust.requiredTrustSignals).forEach((item, index) => addExpectation(expectations, "trustArchitecture.requiredTrustSignals", item, index));
  array(trust.idealPlacement).forEach((item, index) => addExpectation(expectations, "trustArchitecture.idealPlacement", item, index));
  array(trust.proofHierarchy).forEach((item, index) => addExpectation(expectations, "trustArchitecture.proofHierarchy", item, index));

  const content = object(blueprint.contentArchitecture);
  array(content.servicePages).forEach((item, index) => addExpectation(expectations, "contentArchitecture.servicePages", item, index));
  array(content.educationalContent).forEach((item, index) => addExpectation(expectations, "contentArchitecture.educationalContent", item, index));
  array(content.faqTopics).forEach((item, index) => addExpectation(expectations, "contentArchitecture.faqTopics", item, index));
  array(content.comparisonContent).forEach((item, index) => addExpectation(expectations, "contentArchitecture.comparisonContent", item, index));

  const decision = object(blueprint.decisionSupport);
  array(decision.questionsToAnswer).forEach((item, index) => addExpectation(expectations, "decisionSupport.questionsToAnswer", item, index));
  array(decision.objectionsToHandle).forEach((item, index) => addExpectation(expectations, "decisionSupport.objectionsToHandle", item, index));
  array(decision.decisionTriggers).forEach((item, index) => addExpectation(expectations, "decisionSupport.decisionTriggers", item, index));

  array(blueprint.localSEOExpectations).forEach((item, index) => addExpectation(expectations, "localSEOExpectations", item, index));
  array(blueprint.technicalExpectations).forEach((item, index) => addExpectation(expectations, "technicalExpectations", item, index));
  array(blueprint.mobileExpectations).forEach((item, index) => addExpectation(expectations, "mobileExpectations", item, index));
  array(blueprint.userExperiencePrinciples).forEach((item, index) => addExpectation(expectations, "userExperiencePrinciples", item, index));

  const visual = object(blueprint.visualHierarchy);
  addExpectation(expectations, "visualHierarchy.heroPurpose", visual.heroPurpose);
  array(visual.aboveFoldContent).forEach((item, index) => addExpectation(expectations, "visualHierarchy.aboveFoldContent", item, index));
  array(visual.trustPlacement).forEach((item, index) => addExpectation(expectations, "visualHierarchy.trustPlacement", item, index));
  array(visual.ctaPlacement).forEach((item, index) => addExpectation(expectations, "visualHierarchy.ctaPlacement", item, index));

  if (!expectations.length) throw new HttpError(422, "Website Blueprint did not contain comparable expectations");
  return expectations;
}

function relatedCategories(category) {
  return categoryAllowedEvidence[category] || new Set([category]);
}

function expectedObservationCategory(expectation) {
  return categoryForExpectation(expectation, []);
}

function isSeoMetaExpectation(expectation, category) {
  const text = clean(`${expectation.text} ${expectation.section}`).toLowerCase();
  return category === "SEO" || seoMetaSections.has(expectation.section) || /\b(meta|metadata|title tag|meta description|schema|structured data|seo|search)\b/.test(text);
}

function isFaqExpectation(expectation) {
  const text = clean(`${expectation.text} ${expectation.section}`).toLowerCase();
  return expectation.section === "contentArchitecture.faqTopics" || /\b(faq|faqs|frequently asked|question|questions)\b/.test(text);
}

function isRealFaqEvidence(signal, evidenceText) {
  const text = textForMatching(`${signal} ${evidenceText}`);
  if (/continue reading|skip to content|got questions\??/.test(text)) return false;
  if (/\bfaq(page)?\b|frequently asked questions/.test(text)) return true;
  if (/^faq[_-]?question/.test(signal)) return /\?$|^(what|why|how|when|where|who|which|can|do|does|is|are|will|should)\b/i.test(clean(evidenceText));
  return false;
}

function isNavigationEvidence(item) {
  const text = textForMatching(`${item.signal} ${item.evidenceText}`);
  if (/email|phone|instagram|facebook|linkedin|youtube|tiktok|twitter|whatsapp|mailto|tel:|social/.test(text)) return false;
  return (
    item.mappedCategory === "Navigation" ||
    /(_path|_navigation|page_section|service_navigation|about_or_team_path|location_or_service_area_path|pricing_path|faq_path|case_study_or_portfolio_path)$/.test(item.signal) ||
    /\b(path|navigation|nav|menu|page|section|homepage|home|about|services|pricing|faq|contact page|locations|case studies)\b/.test(text)
  );
}

function isSocialLinkEvidence(item) {
  return /\b(instagram|facebook|linkedin|youtube|tiktok|twitter|x_twitter|social_link)\b/i.test(`${item.signal} ${item.evidenceText}`);
}

function isCertificationEvidence(item) {
  if (isSocialLinkEvidence(item)) return false;
  return /\b(certification|certifications|certified|credential|credentials|accredited|accreditation|licensed|license|award|awards|badge|badges|recognised|recognized)\b/i.test(`${item.signal} ${item.evidenceText}`);
}

function isTestimonialEvidence(item) {
  const text = textForMatching(`${item.signal} ${item.evidenceText}`);
  if (isSocialLinkEvidence(item)) return false;
  return /\b(testimonial|testimonials|review|reviews|rating|ratings|stars|google reviews|customers say|clients say|patient reviews)\b/.test(text);
}

function isPricingEvidence(item) {
  const text = textForMatching(`${item.signal} ${item.evidenceText}`);
  if (!/\b(price|pricing|fee|fees|cost|costs|package|packages|rate|rates|quote|quotes|estimate|estimates)\b/.test(text)) return false;
  if (/news|article|blog|press|continue reading/.test(text)) return false;
  return /pricing_path|pricing_content|price|pricing|fees?|costs?|packages?|rates?|quote|estimate/.test(text);
}

function isCaseStudyEvidence(item) {
  if (isSocialLinkEvidence(item)) return false;
  return /\b(case study|case studies|portfolio|project|projects|our work|gallery|before after|before and after)\b/i.test(`${item.signal} ${item.evidenceText}`);
}

function isEducationalContentEvidence(item) {
  const text = textForMatching(`${item.signal} ${item.evidenceText}`);
  if (item.mappedCategory === "Services" || /product_or_service|service_navigation/.test(item.signal)) return false;
  return /\b(guide|report|article|resource|resources|blog|insight|insights|learn|education|educational|whitepaper|knowledge|news)\b/.test(text);
}

function isTechnicalExpectationMatched(expectation, item) {
  const text = expectationText(expectation);
  const evidenceText = textForMatching(`${item.signal} ${item.evidenceText}`);
  if (/\b(ssl|https|secure|certificate)\b/.test(text)) return /\b(ssl|https|secure|certificate)\b/.test(evidenceText);
  if (/\b(speed|load|performance|pagespeed|core web vitals)\b/.test(text)) return /\b(speed|load|performance|pagespeed|core web vitals|loadtime|load time)\b/.test(evidenceText);
  if (/\b(mobile|responsive)\b/.test(text)) return /\b(mobile|responsive|viewport)\b/.test(evidenceText);
  if (/\b(analytics|tracking|ga4|gtm)\b/.test(text)) return /\b(analytics|tracking|ga4|gtm|google tag manager)\b/.test(evidenceText);
  return item.mappedCategory === "Technical";
}

function isSectionExpectation(expectation, sectionName) {
  return expectation.section === sectionName;
}

function expectationText(expectation) {
  return textForMatching(`${expectation.text} ${expectation.section}`);
}

function hasLogicalEvidenceCategory(expectation, item, category) {
  if (item.isMetaEvidence) return category === "SEO" && isSeoMetaExpectation(expectation, category);
  if (isFaqExpectation(expectation)) return item.isFaqEvidence;
  const text = expectationText(expectation);
  if (category === "Trust" && /\btrust\b/.test(text)) {
    return ["Trust", "Proof"].includes(item.mappedCategory) || isCertificationEvidence(item) || isTestimonialEvidence(item);
  }
  if (category === "Navigation" || isSectionExpectation(expectation, "informationArchitecture.criticalPages") || isSectionExpectation(expectation, "informationArchitecture.recommendedPages") || isSectionExpectation(expectation, "informationArchitecture.pagePriority")) {
    return isNavigationEvidence(item);
  }
  if (category === "Pricing") return isPricingEvidence(item);
  if (category === "Technical") return item.mappedCategory === "Technical" && isTechnicalExpectationMatched(expectation, item);
  if (category === "Mobile") return item.mappedCategory === "Mobile" || (item.mappedCategory === "User Experience" && isTechnicalExpectationMatched(expectation, item));
  if (category === "Services") return item.mappedCategory === "Services";
  if (category === "Proof") {
    if (/\b(testimonial|testimonials|review|reviews|rating|ratings)\b/.test(text)) return isTestimonialEvidence(item);
    if (/\b(certification|certifications|certified|credential|credentials|accreditation|accredited|award|awards|badge|badges)\b/.test(text)) return isCertificationEvidence(item);
    if (/\b(case study|case studies|portfolio|project|projects)\b/.test(text)) return isCaseStudyEvidence(item);
    return !isSocialLinkEvidence(item) && ["Proof", "Trust"].includes(item.mappedCategory);
  }
  if (category === "Social Proof") return isTestimonialEvidence(item);
  if (expectation.section === "contentArchitecture.educationalContent") return isEducationalContentEvidence(item);
  if (/\b(certification|certifications|certified|credential|credentials|accreditation|accredited|award|awards|badge|badges)\b/.test(text)) {
    return isCertificationEvidence(item);
  }
  if (/\b(testimonial|testimonials|review|reviews|rating|ratings|social proof)\b/.test(text)) {
    return isTestimonialEvidence(item);
  }
  const categories = relatedCategories(category);
  return categories.has(item.mappedCategory);
}

function requiresExactNavigationLabel(expectation, category) {
  return (
    category === "Navigation" &&
    expectation.section.startsWith("informationArchitecture.") &&
    words(expectation.text).length <= 3
  );
}

function hasExactNavigationLabel(expectation, item) {
  const expected = words(expectation.text);
  const actual = words(item.evidenceText);
  if (!expected.length || !actual.length) return false;
  return expected.every((word) => actual.includes(word));
}

function candidatesForExpectation(expectation, evidence) {
  const category = expectedObservationCategory(expectation);
  const expectationWords = words(expectation.text);
  const allowsCategoryOnly =
    expectationWords.length <= 2 ||
    /\b(trust|proof|conversion|booking|service|navigation|local|technical|mobile|content|pricing|faq|review|testimonial|contact|cta|seo)\b/i.test(expectation.text);
  return evidence
    .filter((item) => hasLogicalEvidenceCategory(expectation, item, category))
    .filter((item) => !requiresExactNavigationLabel(expectation, category) || hasExactNavigationLabel(expectation, item))
    .map((item) => {
      const overlap = tokenOverlap(expectation.text, item.text);
      const categoryMatch = 0.36;
      const signalMatch = tokenOverlap(expectation.text, item.signal) * 0.45;
      const confidenceWeight = Math.min(0.16, item.confidence * 0.16);
      const metaPenalty = item.isMetaEvidence && category !== "SEO" ? 0.45 : 0;
      const matchScore = overlap + categoryMatch + signalMatch + confidenceWeight - metaPenalty;
      const hasTextMatch = overlap >= 0.15 || signalMatch >= 0.15;
      return { ...item, matchScore, overlap, signalMatch, hasTextMatch, categoryOnlyAllowed: allowsCategoryOnly && categoryMatch > 0 };
    })
    .filter((item) => item.hasTextMatch || item.categoryOnlyAllowed)
    .filter((item) => item.matchScore >= 0.34 || item.overlap >= 0.25 || item.signalMatch >= 0.2)
    .sort((a, b) => b.matchScore - a.matchScore || b.confidence - a.confidence)
    .slice(0, 8);
}

function isFrictionPointExpectation(expectation) {
  return expectation.section === "conversionArchitecture.expectedFrictionPoints";
}

function statusFromCandidates(candidates) {
  const explicitAbsent = candidates.find((item) => item.status === "absent" && item.confidence >= 0.72 && item.matchScore >= 0.44);
  if (explicitAbsent) return "absent";
  const unclear = candidates.find((item) => item.status === "unclear" && item.matchScore >= 0.44);
  const present = candidates.filter((item) => item.status === "present");
  if (present.some((item) => item.matchScore >= 0.74 || item.overlap >= 0.5)) {
    const strongCount = present.filter((item) => item.matchScore >= 0.62 || item.overlap >= 0.42).length;
    return strongCount >= 3 ? "exceeds_expectation" : "present";
  }
  if (present.length) return "partial";
  if (unclear) return "unclear";
  return "unclear";
}

function categoryForExpectation(expectation, candidates = []) {
  const text = clean(`${expectation.text} ${expectation.section}`).toLowerCase();
  if (expectation.section.startsWith("informationArchitecture.")) return "Navigation";
  if (expectation.section.startsWith("contentArchitecture.servicePages")) return "Services";
  if (expectation.section.startsWith("contentArchitecture.faqTopics")) return "Decision Support";
  if (expectation.section.startsWith("technicalExpectations")) return "Technical";
  if (expectation.section.startsWith("localSEOExpectations")) return "Local";
  if (expectation.section.startsWith("mobileExpectations")) return "Mobile";
  if (/\b(price|pricing|fee|fees|cost|costs|package|packages|rate|rates|quote|quotes|estimate|estimates)\b/.test(text)) return "Pricing";
  if (/\b(book|booking|appointment|appointments|reservation|reserve|schedule|scheduling)\b/.test(text)) return "Booking";
  if (/\b(review|reviews|testimonial|testimonials|rating|ratings|social proof)\b/.test(text)) return "Social Proof";
  if (/\b(proof|portfolio|case study|case studies|project|projects|logo|logos|partner|partners|before|after)\b/.test(text)) return "Proof";
  if (/\b(local|location|locations|map|maps|near|area|areas|address|google business)\b/.test(text)) return "Local";
  if (/\b(mobile|responsive)\b/.test(text)) return "Mobile";
  if (/\b(seo|search|schema|metadata|title|description)\b/.test(text)) return "SEO";
  if (/\b(speed|ssl|analytics|tracking|technical|performance)\b/.test(text)) return "Technical";
  if (/\b(navigation|menu|architecture)\b/.test(text)) return "Navigation";
  if (/\b(service|services|product|products|treatment|treatments)\b/.test(text)) return "Services";
  if (/\b(question|questions|objection|objections|faq|faqs|comparison|decision)\b/.test(text)) return "Decision Support";
  if (/\b(cta|call to action|contact|call|phone|enquiry|enquiries|inquiry|inquiries|conversion)\b/.test(text)) return "Conversion";
  if (/\b(trust|credential|credentials|award|awards|certified|certification|certifications|accredited|accreditation|team|profile|profiles|doctor|doctors|lawyer|lawyers|staff)\b/.test(text)) return "Trust";
  const candidateCategory = candidates.find((item) => observationCategories.has(item.mappedCategory))?.mappedCategory;
  return candidateCategory || expectation.category;
}

function confidenceForObservation(status, candidates) {
  const best = candidates[0];
  if (!best) return 0.4;
  const base = status === "absent" ? 0.68 : status === "unclear" ? 0.52 : 0.62;
  const score = base + Math.min(0.24, best.matchScore * 0.18) + Math.min(0.14, best.confidence * 0.14);
  return Number(Math.max(0.35, Math.min(0.96, score)).toFixed(2));
}

function statusPhrase(status) {
  if (status === "present") return "present";
  if (status === "partial") return "partially detected";
  if (status === "absent") return "not detected in the available evidence";
  if (status === "exceeds_expectation") return "detected with multiple supporting evidence points";
  return "unclear in the available evidence";
}

function actualText(status, candidates) {
  const sample = candidates.slice(0, 3).map((item) => item.evidenceText).filter(Boolean);
  if (status === "absent") return sample[0] || "A checked evidence item reported absence.";
  if (status === "unclear") return sample[0] || "The available evidence was unclear.";
  return sample.join(" | ");
}

function selectSupportingEvidence(candidates, max = 4, expectation = null, category = "") {
  const selected = [];
  const seenSignals = new Set();
  const seenIds = new Set();
  for (const item of candidates) {
    if (expectation && category && !hasLogicalEvidenceCategory(expectation, item, category)) continue;
    if (seenIds.has(item.id)) continue;
    if (seenSignals.has(item.signal) && selected.length >= 2) continue;
    selected.push(item);
    seenIds.add(item.id);
    seenSignals.add(item.signal);
    if (selected.length >= max) break;
  }
  if (!selected.length && candidates[0]) selected.push(candidates[0]);
  return selected;
}

function buildObservation(expectation, candidates, ordinal) {
  if (!candidates.length) return null;
  const scopedCandidates = isFrictionPointExpectation(expectation)
    ? candidates.filter((item) => item.status === "absent" || item.status === "unclear")
    : candidates;
  if (!scopedCandidates.length) return null;
  const status = statusFromCandidates(scopedCandidates);
  const category = expectedObservationCategory(expectation);
  const supportingCandidates = selectSupportingEvidence(scopedCandidates, 4, expectation, category);
  const supportingEvidence = supportingCandidates
    .filter((item) => item.status === "present" || item.status === "absent" || item.status === "unclear")
    .map((item) => item.id);
  if (!supportingEvidence.length) return null;
  return {
    id: `gap-${ordinal}-${compactIdPart(expectation.section)}-${compactIdPart(expectation.text)}`,
    title: `${expectation.text} is ${statusPhrase(status)}`,
    description: `Blueprint expectation "${expectation.text}" is compared against detected evidence: ${actualText(status, supportingCandidates)}.`,
    category,
    expected: expectation.text,
    actual: actualText(status, supportingCandidates),
    status,
    confidence: confidenceForObservation(status, scopedCandidates),
    supportingEvidence,
    blueprintSection: expectation.section,
    reasoning: `Matched the blueprint section "${expectation.section}" to structured evidence categories/signals using evidence text only.`
  };
}

function validateObservation(observation) {
  return (
    observation &&
    observation.expected &&
    observation.actual &&
    statuses.has(observation.status) &&
    observationCategories.has(observation.category) &&
    Array.isArray(observation.supportingEvidence) &&
    observation.supportingEvidence.length > 0 &&
    observation.blueprintSection &&
    observation.reasoning
  );
}

function usesMetaEvidence(observation) {
  return observation.supportingEvidence.some((id) => /^meta-(title|description)$|^meta_(title|description)$/i.test(id));
}

function diversifyObservations(observations) {
  const maxResults = 60;
  const metaLimit = Math.floor(maxResults * 0.2);
  const evidenceLimit = Math.max(6, Math.ceil(maxResults * 0.15));
  const usage = new Map();
  let metaCount = 0;
  const selected = [];

  for (const observation of observations) {
    const metaBacked = usesMetaEvidence(observation);
    if (metaBacked && metaCount >= metaLimit) continue;
    const primaryEvidenceId = observation.supportingEvidence[0];
    if (primaryEvidenceId && (usage.get(primaryEvidenceId) || 0) >= evidenceLimit) continue;
    const allOverused = observation.supportingEvidence.every((id) => (usage.get(id) || 0) >= evidenceLimit);
    if (allOverused) continue;
    selected.push(observation);
    if (metaBacked) metaCount += 1;
    observation.supportingEvidence.forEach((id) => usage.set(id, (usage.get(id) || 0) + 1));
    if (selected.length >= maxResults) break;
  }

  return selected;
}

export function buildGapAnalysis(input = {}) {
  const blueprint = normalizeBlueprint(input);
  const evidence = normalizeEvidence(input);
  const expectations = flattenBlueprint(blueprint);
  const observations = [];

  expectations.forEach((expectation) => {
    const candidates = candidatesForExpectation(expectation, evidence);
    const observation = buildObservation(expectation, candidates, observations.length + 1);
    if (validateObservation(observation)) observations.push(observation);
  });

  return diversifyObservations(observations);
}
