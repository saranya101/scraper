import OpenAI from "openai";
import { prisma } from "../repositories/prisma.js";
import { logEmailWordLimitQa } from "../utils/emailWordLimit.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { findKnowledgeModel } from "./outreachKnowledgeService.js";

const outreachTypes = ["EMAIL", "LINKEDIN_DM", "COLD_CALL", "FOLLOW_UP_1", "FOLLOW_UP_2"];
const storedOutreachTypes = ["EMAIL", "LINKEDIN_DM", "FOLLOW_UP_1", "FOLLOW_UP_2"];
const statuses = ["DRAFT", "SAVED", "COPIED", "SENT", "ARCHIVED"];
const coldCallPrefix = "[Cold call]";
const lowConfidenceCode = "LOW_CONFIDENCE";
const minEvidenceConfidence = 0.72;
const minOutreachScore = 1400;
const bannedEmailPhrases = [
  /increase revenue/ig,
  /boost conversions/ig,
  /fake urgency/ig,
  /industry-leading/ig,
  /cutting-edge/ig,
  /AI-powered/ig,
  /AI powered/ig,
  /streamline/ig,
  /leverage/ig,
  /robust/ig,
  /opportunity to/ig,
  /increase conversions/ig,
  /boost revenue/ig,
  /robust presence/ig,
  /this indicates/ig,
  /opportunity score/ig,
  /tech stack/ig,
  /PDF/ig,
  /audit report attached/ig,
  /attached report/ig
];

function labelType(type) {
  return {
    EMAIL: "Email",
    LINKEDIN_DM: "LinkedIn DM",
    COLD_CALL: "Cold call",
    FOLLOW_UP_1: "Follow-up 1",
    FOLLOW_UP_2: "Follow-up 2"
  }[type] || "Email";
}

const leadInclude = {
  industryRef: true,
  serviceOpportunities: {
    where: { recommended: true },
    include: { service: true },
    take: 1
  }
};

const positiveEvidenceMap = {
  pageSpeedUsable: {
    compliment: "The site loaded quickly when I checked it, which makes the first impression feel smoother for visitors."
  },
  basicSeoPresent: {
    compliment: "The core page structure is clear, with the main title and headings doing a good job of explaining the business."
  },
  servicePagesPresent: {
    compliment: "The services are easy to find, which helps visitors understand what you offer without having to dig around."
  },
  projectCaseStudyPagesPresent: {
    compliment: "The portfolio/project content gives visitors something concrete to look through before they enquire."
  },
  socialLinksPresent: {
    compliment: "The social links are visible, which gives visitors another way to get a feel for the business."
  },
  phoneVisible: {
    compliment: "The phone number is easy to find, which is useful for visitors who prefer to speak to someone directly."
  },
  emailVisible: {
    compliment: "The email address is visible, which makes direct enquiries straightforward."
  },
  whatsappLinkPresent: {
    compliment: "The WhatsApp option is a nice touch for visitors who want a quick, low-friction way to get in contact."
  },
  contactFormPresent: {
    compliment: "The contact form gives interested visitors a clear way to send an enquiry."
  },
  bookingFormPresent: {
    compliment: "The booking path is clear, which is especially helpful for visitors who are ready to take action."
  },
  awardsVisible: {
    compliment: "The awards/recognition shown on the site add credibility in a way that feels useful for new visitors."
  },
  trustBadgesVisible: {
    compliment: "The trust badges help make the business feel more credible at a glance."
  },
  certificationsVisible: {
    compliment: "The certifications are useful trust signals for visitors who are still deciding."
  },
  testimonialsVisible: {
    compliment: "The testimonials give visitors reassurance from other customers before they enquire."
  },
  reviewsVisible: {
    compliment: "The reviews are visible, which helps build trust before someone reaches out."
  },
  ctaVisible: {
    compliment: "There is a clear call to action on the page, so visitors are not left guessing what to do next."
  },
  portfolioProjectVisuals: {
    compliment: "The visual examples of work give the website a stronger sense of proof and credibility."
  },
  beforeAfterVisuals: {
    compliment: "The before/after visuals are strong proof points because visitors can quickly understand the result."
  }
};

const opportunityEvidenceMap = {
  bookingFormPresent: {
    observation: "I could not find a clear online booking or appointment path on the pages reviewed",
    impact: "That can add friction for visitors who are ready to make an enquiry."
  },
  contactFormPresent: {
    observation: "I could not find a clear contact form on the pages reviewed",
    impact: "That can make it harder for interested visitors to take the next step."
  },
  phoneVisible: {
    observation: "a phone number was not clearly visible on the pages reviewed",
    impact: "That can slow down enquiries from visitors who prefer to call."
  },
  emailVisible: {
    observation: "an email address was not clearly visible on the pages reviewed",
    impact: "That can make direct enquiries less convenient."
  },
  servicePagesPresent: {
    observation: "I could not find clear dedicated pages for the main services",
    impact: "That can make it harder for visitors and search engines to understand the full offer."
  },
  projectCaseStudyPagesPresent: {
    observation: "I could not find a clear portfolio, project, or case-study section",
    impact: "That can limit the proof visitors see before deciding to enquire."
  },
  basicSeoPresent: {
    observation: "some core search metadata or page-heading signals appear to be incomplete",
    impact: "That can reduce how clearly the site communicates its relevance in search."
  },
  pageSpeedUsable: {
    observation: "the site took longer than expected to load during the scan",
    impact: "Slower pages can cause potential customers to leave before enquiring."
  },
  socialLinksPresent: {
    observation: "I could not find clear social links on the pages reviewed",
    impact: "That can make it harder for visitors to verify the business before getting in touch."
  },
  testimonialsVisible: {
    observation: "I could not verify visible testimonials on the reviewed pages",
    impact: "That can leave new visitors with less reassurance before they decide to enquire."
  },
  reviewsVisible: {
    observation: "I could not verify visible reviews on the reviewed pages",
    impact: "That can reduce the amount of trust a new visitor gets before reaching out."
  },
  ctaVisible: {
    observation: "I could not verify a clear call to action in the screenshot review",
    impact: "That can leave interested visitors unsure what the next step should be."
  }
};

const evidenceObservationMap = {
  bookingFormPresent: {
    absent: {
      type: "Weak user journey",
      impactRank: 96,
      observation: "The pages reviewed did not show a clear booking or appointment path.",
      impact: "Visitors who are already interested may need an extra step before they can act.",
      businessValue: "high"
    },
    present: {
      type: "Conversion opportunity",
      impactRank: 82,
      observation: "The site already gives visitors a clear booking or appointment path.",
      impact: "That is a useful base for making the enquiry journey feel even more direct.",
      businessValue: "medium"
    }
  },
  ctaVisible: {
    absent: {
      type: "Conversion opportunity",
      impactRank: 94,
      observation: "The screenshot review could not verify a clear call to action.",
      impact: "Visitors may understand the business but still be unsure what to do next.",
      businessValue: "high"
    },
    present: {
      type: "Underused strength",
      impactRank: 86,
      observation: "The first screen already shows clear action paths for visitors.",
      impact: "That gives the site a strong base for guiding more visitors toward the highest-value action.",
      businessValue: "high"
    }
  },
  contactFormPresent: {
    absent: {
      type: "Weak user journey",
      impactRank: 90,
      observation: "The pages reviewed did not show a clear contact form.",
      impact: "Interested visitors may have to work harder than necessary to make an enquiry.",
      businessValue: "high"
    },
    present: {
      type: "Conversion opportunity",
      impactRank: 76,
      observation: "The site gives visitors a contact form as a clear enquiry path.",
      impact: "That path can be used as an anchor for making the next step feel simpler.",
      businessValue: "medium"
    }
  },
  basicSeoPresent: {
    absent: {
      type: "SEO opportunity",
      impactRank: 88,
      observation: "Some core title, description, or heading signals appear incomplete.",
      impact: "That can make it harder for search engines and visitors to quickly understand the page.",
      businessValue: "high"
    },
    present: {
      type: "SEO opportunity",
      impactRank: 70,
      observation: "The page has the basic structure search engines expect.",
      impact: "That foundation can be built on with more focused content around the most valuable searches.",
      businessValue: "medium"
    }
  },
  pageSpeedUsable: {
    absent: {
      type: "Conversion opportunity",
      impactRank: 86,
      observation: "The page took longer than expected to load during the scan.",
      impact: "Slower pages can lose visitors before they reach the enquiry or booking step.",
      businessValue: "high"
    },
    present: {
      type: "Underused strength",
      impactRank: 68,
      observation: "The site loaded quickly during the scan.",
      impact: "That fast first impression is a useful base for a smoother enquiry journey.",
      businessValue: "medium"
    }
  },
  phoneVisible: {
    absent: {
      type: "Weak user journey",
      impactRank: 82,
      observation: "A phone number was not clearly visible on the pages reviewed.",
      impact: "Visitors who prefer to call may pause or leave instead of taking action.",
      businessValue: "medium"
    },
    present: {
      type: "Conversion opportunity",
      impactRank: 64,
      observation: "The phone number is visible for visitors who prefer a direct enquiry.",
      impact: "That direct contact path can be made more prominent around decision points.",
      businessValue: "medium"
    }
  },
  emailVisible: {
    absent: {
      type: "Weak user journey",
      impactRank: 78,
      observation: "An email address was not clearly visible on the pages reviewed.",
      impact: "Visitors looking for a simple direct contact option may not find one quickly.",
      businessValue: "medium"
    },
    present: {
      type: "Conversion opportunity",
      impactRank: 62,
      observation: "The email contact path is visible.",
      impact: "That gives visitors a low-friction way to ask questions before deciding.",
      businessValue: "medium"
    }
  },
  reviewsVisible: {
    absent: {
      type: "Missing trust signals",
      impactRank: 84,
      observation: "The review scan could not verify visible customer reviews.",
      impact: "New visitors may have less reassurance before choosing to enquire.",
      businessValue: "high"
    },
    present: {
      type: "Credibility opportunity",
      impactRank: 84,
      observation: "Reviews are visible in the reviewed page evidence.",
      impact: "That trust proof is valuable and can be used more deliberately around the enquiry journey.",
      businessValue: "high"
    }
  },
  testimonialsVisible: {
    absent: {
      type: "Missing trust signals",
      impactRank: 82,
      observation: "The scan could not verify visible testimonials.",
      impact: "Visitors may have fewer proof points while deciding whether to enquire.",
      businessValue: "medium"
    },
    present: {
      type: "Credibility opportunity",
      impactRank: 80,
      observation: "Testimonials are visible in the reviewed evidence.",
      impact: "That proof can work harder when placed near key decision points.",
      businessValue: "medium"
    }
  },
  awardsVisible: {
    absent: {
      type: "Credibility opportunity",
      impactRank: 50,
      observation: "The scan did not verify visible awards or media recognition.",
      impact: "If the business has recognition elsewhere, bringing it into the website could support trust.",
      businessValue: "low"
    },
    present: {
      type: "Credibility opportunity",
      impactRank: 83,
      observation: "The evidence shows visible recognition or credibility language.",
      impact: "That credibility is interesting because it can reduce doubt early in the visit.",
      businessValue: "high"
    }
  },
  trustBadgesVisible: {
    absent: {
      type: "Missing trust signals",
      impactRank: 78,
      observation: "The visual scan could not verify visible trust badges.",
      impact: "Visitors may have fewer quick reassurance cues before taking action.",
      businessValue: "medium"
    },
    present: {
      type: "Credibility opportunity",
      impactRank: 80,
      observation: "Trust badges are visible in the reviewed evidence.",
      impact: "Those reassurance cues can help support the next step when placed near enquiries.",
      businessValue: "medium"
    }
  },
  certificationsVisible: {
    absent: {
      type: "Credibility opportunity",
      impactRank: 70,
      observation: "The scan could not verify visible certifications.",
      impact: "If certifications matter to buyers, making them easier to see can support trust.",
      businessValue: "medium"
    },
    present: {
      type: "Credibility opportunity",
      impactRank: 80,
      observation: "Certifications are visible in the reviewed evidence.",
      impact: "Those signals can help reassure visitors before they enquire.",
      businessValue: "medium"
    }
  },
  servicePagesPresent: {
    absent: {
      type: "Content opportunity",
      impactRank: 80,
      observation: "The scan did not find clear dedicated service pages.",
      impact: "Visitors and search engines may have less context about the full offer.",
      businessValue: "medium"
    },
    present: {
      type: "Content opportunity",
      impactRank: 72,
      observation: "The site has service-like pages or links.",
      impact: "That content can be sharpened around the questions visitors ask before enquiring.",
      businessValue: "medium"
    }
  },
  projectCaseStudyPagesPresent: {
    absent: {
      type: "Content opportunity",
      impactRank: 74,
      observation: "The scan did not find clear project, portfolio, or case-study pages.",
      impact: "Visitors may see less proof of outcomes before deciding to enquire.",
      businessValue: "medium"
    },
    present: {
      type: "Underused strength",
      impactRank: 76,
      observation: "The site includes project, portfolio, or case-study style content.",
      impact: "That proof can be useful for helping visitors picture the result before they reach out.",
      businessValue: "medium"
    }
  },
  socialLinksPresent: {
    absent: {
      type: "Credibility opportunity",
      impactRank: 58,
      observation: "The scan did not find clear social links.",
      impact: "Some visitors may have fewer ways to verify the business before getting in touch.",
      businessValue: "low"
    },
    present: {
      type: "Credibility opportunity",
      impactRank: 64,
      observation: "The site links out to social profiles.",
      impact: "That gives visitors another way to build confidence before enquiring.",
      businessValue: "medium"
    }
  },
  firstCtaScrollDepth: {
    present: {
      type: "Conversion opportunity",
      impactRank: 85,
      observation: "The first call to action appears immediately in the reviewed page evidence.",
      impact: "That is a strong starting point for making the first-visit journey more intentional.",
      businessValue: "high"
    }
  },
  whatsappLinkPresent: {
    absent: {
      type: "Conversion opportunity",
      impactRank: 60,
      observation: "The scan did not find a WhatsApp link.",
      impact: "If visitors prefer quick messaging, that channel may not be obvious.",
      businessValue: "low"
    },
    present: {
      type: "Conversion opportunity",
      impactRank: 74,
      observation: "A WhatsApp path is visible in the reviewed evidence.",
      impact: "That can be a useful low-friction enquiry route when it is placed around key decisions.",
      businessValue: "medium"
    }
  }
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstNameFromLead(lead) {
  const contactName = lead.ownerName || lead.contactName || "";
  if (contactName) return cleanText(contactName).split(" ")[0];
  return "there";
}

function safeEmailText(value) {
  let next = String(value || "").replace(/audit report|PDF|attached report/ig, "notes");
  for (const phrase of bannedEmailPhrases) next = next.replace(phrase, "");
  return next
    .replace(/\s+can be\s+\./gi, ".")
    .replace(/\s+can be\s+(to|for)\s+/gi, " can be used $1 ")
    .replace(/\s{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function evidenceIsUsable(signal, desiredValue) {
  if (!signal || signal.value !== desiredValue) return false;
  const confidence = Number(signal.confidence || 0);
  if (desiredValue === "present") return confidence >= 0.72;
  if (desiredValue === "absent") return confidence >= 0.82;
  return false;
}

function evidenceTrace(signalKey, signal, fallbackEvidence = "") {
  return {
    signalKey,
    value: signal?.value || "unknown",
    confidence: Number(signal?.confidence || 0),
    source: signal?.source || "manual",
    evidence: signal?.evidence || fallbackEvidence,
    textRead: signal?.textRead || null,
    detectorVersion: signal?.detectorVersion || null
  };
}

function evidenceItemsFromLead(lead) {
  const signals = lead.scanEvidence?.signals || {};
  return Object.entries(signals)
    .filter(([signalKey]) => signalKey !== "techStackDetected")
    .filter(([, signal]) => ["present", "absent"].includes(signal?.value))
    .filter(([, signal]) => Number(signal?.confidence || 0) >= minEvidenceConfidence)
    .filter(([, signal]) => signal?.evidence)
    .map(([signalKey, signal]) => ({
      id: signalKey,
      label: signal.label || signalKey,
      value: signal.value,
      confidence: Number(signal.confidence || 0),
      source: signal.source || "scanEvidence",
      evidence: signal.evidence,
      textRead: signal.textRead || null,
      region: signal.region || null,
      scrollDepth: signal.scrollDepth ?? null,
      detectorVersion: signal.detectorVersion || lead.scanEvidence?.detectorVersion || null
    }));
}

function screenshotEvidence(lead) {
  return [
    lead.screenshotPath ? { type: "desktop", path: lead.screenshotPath } : null,
    lead.mobileScreenshotPath ? { type: "mobile", path: lead.mobileScreenshotPath } : null,
    lead.scanEvidence?.fullPageScreenshotPath ? { type: "fullPage", path: lead.scanEvidence.fullPageScreenshotPath } : null
  ].filter(Boolean);
}

function normalizeObservation(raw = {}, evidenceById = new Map()) {
  const evidenceIds = Array.isArray(raw.evidenceIds) ? raw.evidenceIds.filter((id) => evidenceById.has(id)) : [];
  if (!evidenceIds.length) return null;
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence || 0)));
  const businessImpact = Math.max(0, Math.min(10, Number(raw.businessImpact || 0)));
  const specificity = Math.max(0, Math.min(10, Number(raw.specificity || 0)));
  const conversationPotential = Math.max(0, Math.min(10, Number(raw.conversationPotential || 0)));
  const uniqueness = Math.max(0, Math.min(10, Number(raw.uniqueness || 0)));
  const industryRelevance = Math.max(0, Math.min(10, Number(raw.industryRelevance || raw.businessImpact || 0)));
  const computedOverallScore = Math.round(confidence * businessImpact * specificity * conversationPotential * uniqueness * industryRelevance);
  const rawOverallScore = Number(raw.overallScore || raw.outreachScore || 0);
  const overallScore = rawOverallScore > 100 ? rawOverallScore : computedOverallScore;
  return {
    id: cleanText(raw.id || evidenceIds.join("-")),
    signal: cleanText(raw.signal || evidenceIds[0] || ""),
    status: cleanText(raw.status || evidenceById.get(evidenceIds[0])?.value || ""),
    title: cleanText(raw.title || "Website observation"),
    description: cleanText(raw.description || ""),
    category: cleanText(raw.category || "Observation"),
    confidence,
    businessImpact,
    specificity,
    conversationPotential,
    uniqueness,
    industryRelevance,
    overallScore,
    outreachScore: overallScore,
    evidenceIds,
    notes: Array.isArray(raw.notes) ? raw.notes.map(cleanText).filter(Boolean) : [],
    trace: evidenceIds.map((id) => evidenceById.get(id))
  };
}

function observationText(observation = {}) {
  return `${observation.title || ""} ${observation.description || ""} ${(observation.notes || []).join(" ")}`.toLowerCase();
}

function critiqueObservation(observation = {}) {
  const text = observationText(observation);
  const evidenceIds = observation.evidenceIds || [];
  const hasAbsentEvidence = (observation.trace || []).some((item) => item?.value === "absent");
  const hasPlacementOrFriction = /buried|below|hidden|hard to|difficult|friction|missing|absent|unclear|weak|not clear|after scrolling|too low|could work harder|underused|no clear/i.test(text);
  const obviousOnly = evidenceIds.length === 1 && /^(phoneVisible|emailVisible|ctaVisible|servicePagesPresent|bookingFormPresent|socialLinksPresent|pageSpeedUsable)$/.test(evidenceIds[0]);
  const banned = bannedEmailPhrases.some((phrase) => {
    phrase.lastIndex = 0;
    return phrase.test(text);
  });
  if (banned) return { keep: false, reason: "uses_banned_or_jargony_language" };
  if (obviousOnly && !hasAbsentEvidence && !hasPlacementOrFriction) return { keep: false, reason: "obvious_feature_description" };
  if (Number(observation.conversationPotential || 0) < 5) return { keep: false, reason: "low_conversation_potential" };
  if (Number(observation.specificity || 0) < 5) return { keep: false, reason: "low_specificity" };
  if (Number(observation.businessImpact || 0) < 5) return { keep: false, reason: "low_business_impact" };
  return { keep: true, reason: "kept" };
}

function critiqueAndRankObservations(observations = []) {
  const critiqued = observations.map((observation) => {
    const critique = critiqueObservation(observation);
    return { ...observation, critique };
  });
  return {
    critiqued,
    kept: critiqued
      .filter((item) => item.critique.keep)
      .sort((a, b) => Number(b.outreachScore || 0) - Number(a.outreachScore || 0))
  };
}

function fallbackObservationAnalysis(lead, evidenceItems, consultantKnowledge = null) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.id, item]));
  const candidates = evidenceItems
    .filter((item) => item.value === "absent")
    .map((item) => normalizeObservation({
      id: item.id,
      title: `${item.label} needs review`,
      description: `${item.evidence} This may be worth checking because it could affect how easily visitors take the next step.`,
      category: "UX",
      confidence: item.confidence,
      businessImpact: 5,
      specificity: 4,
      conversationPotential: 4,
      uniqueness: 3,
      evidenceIds: [item.id]
    }, evidenceById))
    .filter(Boolean);
  const { critiqued, kept } = critiqueAndRankObservations(candidates);
  const rankedObservations = kept.length ? kept : critiqued.sort((a, b) => b.outreachScore - a.outreachScore);
  return {
    businessUnderstanding: normalizeBusinessUnderstanding({}, lead),
    expectationModel: consultantKnowledgeToExpectationModel(consultantKnowledge) || expectationModelFromLead(lead, normalizeBusinessUnderstanding({}, lead)),
    consultantKnowledge,
    observations: critiqued,
    rankedObservations,
    selectedObservation: rankedObservations[0] || null,
    critique: critiqued.map((item) => ({ id: item.id, keep: item.critique.keep, reason: item.critique.reason })),
    source: "fallback"
  };
}

function structuredObservationsFromEvidence(lead, evidenceById) {
  return (evidencePacket(lead).observations || [])
    .map((item) => normalizeObservation({
      id: `${item.signalKey}-${item.value}`,
      signal: item.signalKey,
      status: item.value,
      title: item.type,
      description: item.observation,
      category: item.type,
      confidence: item.confidence,
      businessImpact: Math.max(5, Math.min(10, Math.round(Number(item.impactRank || 60) / 10))),
      specificity: item.value === "absent" ? 8 : 6,
      conversationPotential: item.businessValue === "high" ? 8 : 6,
      uniqueness: item.value === "absent" ? 7 : 5,
      industryRelevance: item.businessValue === "high" ? 8 : 6,
      evidenceIds: [item.signalKey],
      notes: [item.impact].filter(Boolean)
    }, evidenceById))
    .filter(Boolean);
}

function businessUnderstandingFromLead(lead) {
  const saved = lead.scanEvidence?.businessUnderstanding;
  const identity = saved?.businessIdentity || saved || {};
  const offering = saved?.businessOffering || saved || {};
  const purpose = saved?.websitePurpose || saved || {};
  if (saved && Number(identity.industryConfidence || 0) >= 0.8) {
    return {
      industry: cleanText(identity.industry || ""),
      confidence: Number(identity.industryConfidence || 0),
      primaryGoal: cleanText(purpose.businessGoal || purpose.websitePrimaryGoal || "turn interested visitors into enquiries"),
      businessModel: cleanText(identity.businessModel || "local service business"),
      serviceCategories: Array.isArray(offering.serviceCategories) ? offering.serviceCategories.map(cleanText).filter(Boolean) : []
    };
  }
  const industry = industryContext(lead);
  const services = (lead.serviceOpportunities || [])
    .map((item) => item.service?.name)
    .filter(Boolean)
    .slice(0, 4);
  return {
    industry: industry.mentionable ? industry.industry : "",
    confidence: industry.mentionable ? industry.industryConfidence : 0,
    primaryGoal: "turn interested visitors into enquiries",
    businessModel: "local service business",
    serviceCategories: services
  };
}

function normalizeBusinessUnderstanding(raw = {}, lead) {
  const fallback = businessUnderstandingFromLead(lead);
  const confidence = Number(raw.confidence ?? fallback.confidence ?? 0);
  return {
    industry: confidence >= 0.8 ? cleanText(raw.industry || fallback.industry || "") : "",
    confidence: confidence >= 0.8 ? confidence : 0,
    primaryGoal: cleanText(raw.primaryGoal || fallback.primaryGoal),
    businessModel: cleanText(raw.businessModel || fallback.businessModel),
    serviceCategories: Array.isArray(raw.serviceCategories) && raw.serviceCategories.length
      ? raw.serviceCategories.map(cleanText).filter(Boolean)
      : fallback.serviceCategories
  };
}

function expectationModelFromLead(lead, businessUnderstanding = businessUnderstandingFromLead(lead)) {
  return {
    expectedTrustSignals: ["credible proof", "reviews or testimonials", "clear contact details"],
    expectedBookingFlow: ["clear next step", "low-friction enquiry path"],
    expectedConversionPath: ["visitor understands the offer", "visitor sees proof", "visitor knows how to enquire"],
    expectedContent: ["services", "proof of work", "answers to common buyer questions"],
    expectedCredibilitySignals: ["reviews", "profiles", "recognition", "visible reassurance"],
    expectedCustomerJourney: ["understand", "trust", "act"],
    expectedDifferentiation: businessUnderstanding.serviceCategories || [],
    expectedProof: ["reviews", "examples", "outcomes"],
    expectedSeoStructure: ["clear title", "headings", "service-focused pages"],
    expectedLocalBusinessSignals: ["location", "phone", "email", "map or address"]
  };
}

function consultantKnowledgeToExpectationModel(consultantKnowledge) {
  if (!consultantKnowledge) return null;
  return {
    expectedTrustSignals: consultantKnowledge.trustSignals || consultantKnowledge.expectedTrustElements || [],
    expectedBookingFlow: consultantKnowledge.criticalConversionPoints || [],
    expectedConversionPath: consultantKnowledge.customerJourney || [],
    expectedContent: consultantKnowledge.expectedContentStructure || consultantKnowledge.highValuePages || [],
    expectedCredibilitySignals: consultantKnowledge.expectedTrustElements || consultantKnowledge.expectedProofElements || [],
    expectedCustomerJourney: consultantKnowledge.customerJourney || [],
    expectedDifferentiation: consultantKnowledge.competitiveDifferentiators || [],
    expectedProof: consultantKnowledge.expectedProofElements || [],
    expectedSeoStructure: consultantKnowledge.seoPriorities || [],
    expectedLocalBusinessSignals: consultantKnowledge.localBusinessSignals || []
  };
}

function buildAnalysisPrompt({ lead, sender, evidenceItems, industry, consultantKnowledge = null }) {
  return `Analyse website evidence for a cold outreach email. Do not write the email yet.

Company: ${lead.company}
Website: ${lead.website}
${industry.mentionable ? `Industry: ${industry.industry}` : "Industry: not trusted; do not use industry assumptions."}

Sender:
${sender.senderName}
${sender.senderTitle}
${sender.companyName}

Evidence items, each with an id. You may only make observations from these items:
${JSON.stringify(evidenceItems, null, 2)}

Reusable Phase 0 consultant knowledge model:
${consultantKnowledge ? JSON.stringify(consultantKnowledge, null, 2) : "None available. Build expectations from trusted industry context and evidence only."}

Pipeline:
Stage 1: understand the business from company name, website, trusted industry context, and evidence.
Stage 2: build a dynamic expectation model: what an excellent website for this specific business should normally contain. Use the Phase 0 knowledge model as reusable context if supplied.
Stage 3: convert evidence into structured observations. Do not write emails.
Stage 4: score observations relative to the expectation model and this business.
Stage 5: critique observations. Reject anything the owner already knows, anything that simply describes the site, anything generic, anything that could be sent to hundreds of businesses, and anything that sounds like marketing theory.
Stage 6: select ONE best observation.

Observation categories are open-ended and may include Trust, Credibility, Conversion, UX, SEO, Booking journey, Content, Navigation, Calls to action, Performance, Social proof, Visual hierarchy, Mobile, Brand positioning, Competitive differentiation, Accessibility.

Scoring:
overallScore = confidence × businessImpact × specificity × conversationPotential × uniqueness × industryRelevance.
confidence is 0-1. The other score inputs are 0-10.

High scoring observations are unique to this company, evidence-backed, meaningful, specific, and likely to start a reply.
Low scoring observations are obvious facts such as "phone visible", "email visible", "CTA exists", "navigation works", or generic statements.

If there are no major problems, select the strongest optimisation opportunity, such as an underused strength, something buried too low, something that could work harder, or unnecessary friction.

Return strict JSON:
{
  "businessUnderstanding": {
    "industry": "",
    "confidence": 0.0,
    "primaryGoal": "",
    "businessModel": "",
    "serviceCategories": []
  },
  "expectationModel": {
    "expectedTrustSignals": [],
    "expectedBookingFlow": [],
    "expectedConversionPath": [],
    "expectedContent": [],
    "expectedCredibilitySignals": [],
    "expectedCustomerJourney": [],
    "expectedDifferentiation": [],
    "expectedProof": [],
    "expectedSeoStructure": [],
    "expectedLocalBusinessSignals": []
  },
  "observations": [
    {
      "id": "",
      "signal": "",
      "status": "",
      "title": "",
      "description": "",
      "category": "",
      "confidence": 0.0,
      "businessImpact": 0,
      "specificity": 0,
      "conversationPotential": 0,
      "uniqueness": 0,
      "industryRelevance": 0,
      "overallScore": 0,
      "evidenceIds": [],
      "notes": []
    }
  ],
  "critique": [
    { "id": "", "keep": true, "reason": "" }
  ],
  "rankedObservationIds": [],
  "selectedObservationId": ""
}

Rules:
- Do not invent observations.
- Every observation must include evidenceIds from the provided evidence list.
- Do not select low-value obvious facts unless absolutely nothing better exists.
- Do not use these words: streamline, leverage, increase conversions, boost revenue, industry-leading, cutting-edge, AI-powered, robust presence, this indicates.
- Prefer observations that make the owner pause.
- Reject observations that only describe existing features.
- Do not mention PDFs, reports, attachments, scores, or internal tools.`;
}

async function analyseAndRankObservations({ lead, sender, industry, consultantKnowledge = null }) {
  const evidenceItems = evidenceItemsFromLead(lead);
  const evidenceById = new Map(evidenceItems.map((item) => [item.id, item]));
  if (!evidenceItems.length) {
    throw lowConfidence({
      reason: "No usable scanEvidence items were available for outreach analysis.",
      companyName: lead.company,
      websiteUrl: lead.website,
      scanEvidenceStatus: lead.scanEvidence?.status || "missing"
    });
  }

  if (!process.env.OPENAI_API_KEY) return fallbackObservationAnalysis(lead, evidenceItems, consultantKnowledge);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let parsed;
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You analyse verified website evidence for thoughtful cold outreach. You do not write emails in this step. Return strict JSON." },
        { role: "user", content: buildAnalysisPrompt({ lead, sender, evidenceItems, industry, consultantKnowledge }) }
      ],
      temperature: 0.25
    });
    parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch (error) {
    console.warn("[email-generation-analysis-fallback]", error.message);
    return fallbackObservationAnalysis(lead, evidenceItems, consultantKnowledge);
  }
  const aiObservations = Array.isArray(parsed.observations)
    ? parsed.observations.map((item) => normalizeObservation(item, evidenceById)).filter(Boolean)
    : [];
  const localObservations = structuredObservationsFromEvidence(lead, evidenceById);
  const observationMap = new Map([...aiObservations, ...localObservations].map((item) => [item.id, item]));
  const observations = Array.from(observationMap.values());
  const critiqueById = new Map((Array.isArray(parsed.critique) ? parsed.critique : []).map((item) => [item.id, item]));
  const withAiCritique = observations.map((observation) => {
    const localCritique = critiqueObservation(observation);
    const aiCritique = critiqueById.get(observation.id);
    const keep = localCritique.keep && aiCritique?.keep !== false;
    return {
      ...observation,
      critique: {
        keep,
        reason: keep ? "kept" : (aiCritique?.reason || localCritique.reason)
      }
    };
  });
  const keptObservations = withAiCritique.filter((item) => item.critique.keep);
  const byId = new Map(withAiCritique.map((item) => [item.id, item]));
  const rankedFromAi = Array.isArray(parsed.rankedObservationIds)
    ? parsed.rankedObservationIds.map((id) => byId.get(id)).filter(Boolean)
    : [];
  const rankedObservations = [
    ...rankedFromAi.filter((item) => item.critique.keep),
    ...keptObservations.filter((item) => !rankedFromAi.some((ranked) => ranked.id === item.id)).sort((a, b) => b.outreachScore - a.outreachScore)
  ];
  const selectedFromAi = byId.get(parsed.selectedObservationId);
  const selectedObservation = selectedFromAi?.critique.keep ? selectedFromAi : rankedObservations[0] || null;
  const businessUnderstanding = normalizeBusinessUnderstanding(parsed.businessUnderstanding || {}, lead);
  const expectationModel = parsed.expectationModel || consultantKnowledgeToExpectationModel(consultantKnowledge) || expectationModelFromLead(lead, businessUnderstanding);
  return {
    businessUnderstanding,
    expectationModel,
    consultantKnowledge,
    observations: withAiCritique,
    rankedObservations,
    selectedObservation,
    critique: withAiCritique.map((item) => ({ id: item.id, keep: item.critique.keep, reason: item.critique.reason })),
    source: "openai"
  };
}

function buildEmailWritingPrompt({ lead, sender, selectedObservation, selectedCompliment, industry }) {
  return `Write a cold email using only the selected observation. Do not add new claims.

Company: ${lead.company}
Website: ${lead.website}
${industry.mentionable ? `Industry: ${industry.industry}` : "Industry: not trusted; do not mention industry or niche."}

Sender signature:
${sender.signature}

Positive observation, if useful:
${selectedCompliment ? JSON.stringify({ compliment: selectedCompliment.compliment, trace: selectedCompliment.trace }) : "None"}

Selected observation:
${JSON.stringify({
  title: selectedObservation.title,
  description: selectedObservation.description,
  category: selectedObservation.category,
  evidenceIds: selectedObservation.evidenceIds,
  trace: selectedObservation.trace
}, null, 2)}

Return strict JSON:
{
  "emailVersions": [
    { "style": "Professional", "subject": "", "observation": "", "impact": "" },
    { "style": "Friendly", "subject": "", "observation": "", "impact": "" },
    { "style": "Curious", "subject": "", "observation": "", "impact": "" }
  ]
}

Style:
- Natural, professional, conversational.
- Write like a real email with normal paragraphs.
- Do not expose prompt structure.
- Do not use labels such as "One thing I liked", "One thing I noticed", "Observation", or "Impact".
- No marketing fluff.
- No buzzwords.
- No AI language.
- Objective is a reply, not booking a meeting.
- Never ask for a meeting.
- Do not mention PDFs, reports, attachments, scores, or tech stack.
- Every claim must trace to the selected observation evidence.
- The observation should sound like: "I noticed something interesting about your business."
- Use a soft CTA like: "I noted down a couple of other things while looking through the site too. Happy to send them over if it'd be useful."`;
}

function observationFromSignal(signalKey, signal, correction = null) {
  const value = correction?.value || signal?.value;
  const config = evidenceObservationMap[signalKey]?.[value];
  if (!config) return null;
  const confidence = correction ? 1 : Number(signal?.confidence || 0);
  const minimum = value === "absent" ? 0.82 : 0.72;
  if (confidence < minimum) return null;
  if (!correction && !signal?.evidence) return null;
  if (config.businessValue === "low") return null;
  const trace = evidenceTrace(
    signalKey,
    correction
      ? { value, confidence: 1, source: "manual", evidence: correction.notes || `Manually reviewed as ${value}.` }
      : signal
  );
  return {
    signalKey,
    value,
    ...config,
    confidence,
    source: trace.source,
    evidence: trace.evidence,
    textRead: trace.textRead,
    detectorVersion: trace.detectorVersion,
    trace
  };
}

function evidencePacket(lead) {
  const corrections = new Map((lead.evidenceCorrections || []).map((item) => [item.signalKey, item]));
  const signals = lead.scanEvidence?.signals || {};
  const machineEvidenceUsable = ["evidence_complete", "COMPLETED"].includes(lead.scanEvidence?.status);
  const positives = [];
  const opportunities = [];
  const observations = [];
  const seen = new Set();

  for (const [signalKey, copy] of Object.entries(positiveEvidenceMap)) {
    const correction = corrections.get(signalKey);
    if (correction) {
      const observation = observationFromSignal(signalKey, null, correction);
      if (observation) observations.push(observation);
      if (correction.value === "present") {
        const trace = evidenceTrace(signalKey, { value: "present", confidence: 1, source: "manual", evidence: correction.notes || "Manually reviewed as present." });
        positives.push({ signalKey, ...copy, ...trace, trace });
        seen.add(signalKey);
      }
      continue;
    }
    if (!machineEvidenceUsable) continue;
    const signal = signals[signalKey];
    const observation = observationFromSignal(signalKey, signal);
    if (observation) observations.push(observation);
    if (evidenceIsUsable(signal, "present") && signal.evidence) {
      const trace = evidenceTrace(signalKey, signal);
      positives.push({ signalKey, ...copy, ...trace, trace });
      seen.add(signalKey);
    }
  }

  for (const [signalKey, copy] of Object.entries(opportunityEvidenceMap)) {
    const correction = corrections.get(signalKey);
    if (correction) {
      const observation = observationFromSignal(signalKey, null, correction);
      if (observation) observations.push(observation);
      if (correction.value === "absent") {
        const trace = evidenceTrace(signalKey, { value: "absent", confidence: 1, source: "manual", evidence: correction.notes || "Manually reviewed as absent." });
        opportunities.push({ signalKey, improvement: true, ...copy, ...trace, trace });
      }
      continue;
    }
    if (!machineEvidenceUsable) continue;
    const signal = signals[signalKey];
    const observation = observationFromSignal(signalKey, signal);
    if (observation) observations.push(observation);
    if (evidenceIsUsable(signal, "absent") && signal.evidence) {
      const trace = evidenceTrace(signalKey, signal);
      opportunities.push({ signalKey, improvement: true, ...copy, ...trace, trace });
    }
  }

  for (const signalKey of Object.keys(evidenceObservationMap)) {
    const correction = corrections.get(signalKey);
    if (correction) {
      const observation = observationFromSignal(signalKey, null, correction);
      if (observation) observations.push(observation);
      continue;
    }
    if (!machineEvidenceUsable) continue;
    const observation = observationFromSignal(signalKey, signals[signalKey]);
    if (observation) observations.push(observation);
  }

  return {
    status: lead.scanEvidence?.status || "evidence_not_run",
    detectorVersion: lead.scanEvidence?.detectorVersion || null,
    positives: positives.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 6),
    opportunities: opportunities
      .filter((item) => item.improvement === true && item.value === "absent" && Number(item.confidence || 0) >= 0.82)
      .sort((a, b) => {
        const priority = ["bookingFormPresent", "contactFormPresent", "ctaVisible", "phoneVisible", "emailVisible", "pageSpeedUsable", "servicePagesPresent", "projectCaseStudyPagesPresent"];
        return (priority.indexOf(a.signalKey) === -1 ? 99 : priority.indexOf(a.signalKey)) - (priority.indexOf(b.signalKey) === -1 ? 99 : priority.indexOf(b.signalKey));
      })
      .slice(0, 6),
    observations: [...new Map(observations.map((item) => [`${item.signalKey}:${item.value}:${item.type}`, item])).values()]
      .sort((a, b) => {
        const impactDelta = Number(b.impactRank || 0) - Number(a.impactRank || 0);
        if (impactDelta) return impactDelta;
        return Number(b.confidence || 0) - Number(a.confidence || 0);
      })
      .slice(0, 10),
    rawSignals: Object.fromEntries(Object.entries(signals).filter(([, signal]) => ["present", "absent"].includes(signal?.value)).slice(0, 20)),
    hasManualCorrections: corrections.size > 0,
    positiveSignalKeys: Array.from(seen)
  };
}

function senderProfile(user, persona = {}) {
  const companyName = persona.enabled ? (persona.companyName || "Ocia Studio") : (user?.companyName || "Ocia Studio");
  const name = persona.enabled ? persona.assistantName : (user?.senderName || user?.name);
  const title = persona.enabled ? persona.assistantTitle : (user?.senderTitle || "Founder");
  return {
    senderName: cleanText(name || "Ocia Studio"),
    senderTitle: cleanText(title || "Founder"),
    senderEmail: cleanText(user?.senderEmail || user?.email || ""),
    companyName: cleanText(companyName || "Ocia Studio"),
    signature: persona.enabled
      ? [name, title, companyName].filter(Boolean).join("\n")
      : (user?.signature || [name || user?.name, title || "Founder", companyName].filter(Boolean).join("\n")),
    profilePhoto: persona.enabled ? persona.assistantAvatar || null : user?.profilePhoto || null,
    usingPersona: Boolean(persona.enabled)
  };
}

async function getOutreachPersona() {
  const saved = await prisma.appSetting.findUnique({ where: { key: "outreachPersona" } });
  const value = saved?.value || {};
  return {
    enabled: value.enabled === true,
    assistantName: cleanText(value.assistantName || ""),
    assistantTitle: cleanText(value.assistantTitle || ""),
    assistantAvatar: cleanText(value.assistantAvatar || ""),
    companyName: cleanText(value.companyName || "Ocia Studio")
  };
}

async function userSenderProfile(userId) {
  const [user, persona] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, senderName: true, senderTitle: true, senderEmail: true, companyName: true, signature: true, profilePhoto: true }
    }),
    getOutreachPersona()
  ]);
  return senderProfile(user, persona);
}

function industryContext(lead) {
  const businessUnderstanding = lead.scanEvidence?.businessUnderstanding;
  const identity = businessUnderstanding?.businessIdentity || businessUnderstanding || {};
  if (businessUnderstanding && Number(identity.industryConfidence || 0) >= 0.8 && identity.industry) {
    return {
      industry: cleanText(identity.industry),
      industrySource: "businessUnderstanding",
      industryConfidence: Number(identity.industryConfidence || 0),
      mentionable: true
    };
  }
  const evidence = lead.scanEvidence || {};
  const evidenceIndustry = evidence.industry || evidence.industryClassification || {};
  const evidenceName = cleanText(evidenceIndustry.name || evidenceIndustry.industry || evidence.industry || "");
  const evidenceConfidence = Number(evidenceIndustry.confidence ?? evidence.industryConfidence ?? 0);
  if (evidenceName && evidenceConfidence >= 0.8) {
    return {
      industry: evidenceName,
      industrySource: evidenceIndustry.source || evidence.industrySource || "scanEvidence",
      industryConfidence: evidenceConfidence,
      mentionable: true
    };
  }

  const label = cleanText(lead.industryRef?.name || lead.industry || "");
  return {
    industry: label || "",
    industrySource: label ? (lead.industryRef ? "lead.industryRef" : "lead.industry") : "none",
    industryConfidence: evidenceConfidence || 0.6,
    mentionable: false
  };
}

function lowConfidence(details = {}) {
  return new HttpError(422, lowConfidenceCode, {
    code: lowConfidenceCode,
    ...details
  });
}

function selectedEmailEvidence(lead) {
  const packet = evidencePacket(lead);
  const selectedCompliment = packet.positives[0] || null;
  const selectedObservation = packet.observations[0] || null;
  const industry = industryContext(lead);
  return { packet, selectedCompliment, selectedObservation, industry };
}

async function consultantKnowledgeForLead(lead, industry) {
  const saved = lead.scanEvidence?.businessUnderstanding;
  const identity = saved?.businessIdentity || saved || {};
  const verifiedBusinessType = Number(identity.industryConfidence || 0) >= 0.8 ? cleanText(identity.businessType) : "";
  const businessType = industry.mentionable
    ? industry.industry
    : verifiedBusinessType || cleanText(lead.industryRef?.name || lead.industry || "");
  if (!businessType) return null;
  try {
    return await findKnowledgeModel({
      businessType,
      industry: Number(identity.industryConfidence || 0) >= 0.8 ? cleanText(identity.industry || businessType) : businessType,
      country: lead.country || "",
      targetMarket: lead.location || lead.address || ""
    });
  } catch {
    return null;
  }
}

function worthwhileCompliment(packet, selectedObservation = null) {
  const usedEvidence = new Set(selectedObservation?.evidenceIds || []);
  const worthwhileKeys = new Set([
    "reviewsVisible",
    "testimonialsVisible",
    "awardsVisible",
    "trustBadgesVisible",
    "certificationsVisible",
    "bookingFormPresent",
    "ctaVisible",
    "firstCtaScrollDepth",
    "projectCaseStudyPagesPresent",
    "portfolioProjectVisuals",
    "beforeAfterVisuals",
    "socialLinksPresent",
    "basicSeoPresent",
    "pageSpeedUsable"
  ]);
  return packet.positives.find((item) => worthwhileKeys.has(item.signalKey) && !usedEvidence.has(item.signalKey)) || null;
}

function assertValidEmailEvidence({ lead, selectedObservation, packet, industry }) {
  if (!selectedObservation) {
    throw lowConfidence({
      reason: "No evidence-backed observation with meaningful business value was found for this lead.",
      companyName: lead.company,
      websiteUrl: lead.website,
      industry: industry.industry,
      industrySource: industry.industrySource,
      industryConfidence: industry.industryConfidence,
      scanEvidenceStatus: packet.status
    });
  }
  const traces = Array.isArray(selectedObservation.trace) ? selectedObservation.trace : [selectedObservation.trace].filter(Boolean);
  if (!traces.some((trace) => trace?.evidence)) {
    throw lowConfidence({
      reason: "Selected observation did not include a scanEvidence trace.",
      companyName: lead.company,
      websiteUrl: lead.website,
      selectedObservation
    });
  }
  if (Number(selectedObservation.outreachScore || 0) < minOutreachScore) {
    throw lowConfidence({
      reason: "Best observation did not have enough business value for outreach.",
      companyName: lead.company,
      websiteUrl: lead.website,
      industry: industry.industry,
      industrySource: industry.industrySource,
      industryConfidence: industry.industryConfidence,
      scanEvidenceStatus: packet.status,
      selectedObservation
    });
  }
}

function emailAiInput({ lead, packet, selectedCompliment, selectedObservation, industry, analysis = null }) {
  return {
    companyName: lead.company,
    websiteUrl: lead.website,
    industry: industry.mentionable ? industry.industry : null,
    industrySource: industry.industrySource,
    industryConfidence: industry.industryConfidence,
    industrySuppressed: !industry.mentionable,
    scanEvidence: lead.scanEvidence || null,
    businessUnderstanding: analysis?.businessUnderstanding || null,
    expectationModel: analysis?.expectationModel || null,
    consultantKnowledge: analysis?.consultantKnowledge || null,
    selectedCompliment,
    selectedObservation,
    candidateObservations: analysis?.observations || packet.observations || [],
    rankedObservations: analysis?.rankedObservations || packet.observations || [],
    analysisSource: analysis?.source || "local",
    screenshots: screenshotEvidence(lead),
    evidenceStatus: packet.status,
    detectorVersion: packet.detectorVersion
  };
}

function logEmailAiInput(input) {
  console.info("[email-generation-ai-input]", JSON.stringify(input, null, 2));
}

function composeEvidenceEmail({ lead, sender, tone, selectedCompliment, selectedObservation, rewrite = {} }) {
  const compliment = selectedCompliment?.compliment || "";
  const observation = selectedObservation;
  const rewrittenObservation = safeEmailText(rewrite.observation || observation.observation || observation.description || observation.title);
  const rewrittenImpact = safeEmailText(rewrite.impact || observation.impact || "That may be worth looking at because it affects how clearly visitors understand the next step.");
  const intro = `I'm ${sender.senderName} from ${sender.companyName}.`;
  const cta = "Was that intentional?";
  const observationLine = `One thing that stood out was that ${rewrittenObservation.replace(/\.$/, "")}.`;
  const body = [
    `Hi ${firstNameFromLead(lead)},`,
    "",
    `I came across ${lead.company}'s website earlier today.`,
    "",
    `What stood out was that ${rewrittenObservation.replace(/\.$/, "")}.`,
    "",
    rewrittenImpact,
    "",
    cta,
    "",
    sender.signature
  ].join("\n");

  return {
    subject: `Quick thought about ${lead.company}`,
    compliment,
    observation: observationLine,
    impact: rewrittenImpact,
    intro,
    cta,
    fullMessage: safeEmailText(body),
    tone
  };
}

function styleInstructions(style) {
  return {
    Professional: "Plain, polished, founder-to-owner. No hype.",
    Friendly: "Warm and relaxed, but still concise and professional.",
    Curious: "Lightly curious and thoughtful, framed around one interesting point."
  }[style] || "Plain English.";
}

function composeEmailVersion({ lead, sender, tone, selectedCompliment, selectedObservation, rewrite = {}, style = "Professional" }) {
  const draft = composeEvidenceEmail({ lead, sender, tone, selectedCompliment, selectedObservation, rewrite });
  return {
    style,
    subject: draft.subject,
    body: draft.fullMessage,
    draft
  };
}

function fallbackEmailVersions({ lead, sender, tone, selectedCompliment, selectedObservation, rewrite = {} }) {
  return ["Professional", "Friendly", "Curious"].map((style) =>
    composeEmailVersion({ lead, sender, tone, selectedCompliment, selectedObservation, rewrite, style })
  );
}

function fallbackEmailDraft(lead, tone, sender, evidence = selectedEmailEvidence(lead)) {
  const { packet, selectedCompliment, selectedObservation, industry } = evidence;
  assertValidEmailEvidence({ lead, selectedObservation, packet, industry });
  return composeEvidenceEmail({ lead, sender, tone, selectedCompliment, selectedObservation });
}

function emailResultFromVersions({ analysis, selectedObservation, emailVersions }) {
  const primary = emailVersions[0]?.draft || {
    subject: emailVersions[0]?.subject || "",
    fullMessage: emailVersions[0]?.body || ""
  };
  return {
    ...primary,
    analysis: {
      source: analysis.source,
      businessUnderstanding: analysis.businessUnderstanding || null,
      expectationModel: analysis.expectationModel || null,
      consultantKnowledgeUsed: Boolean(analysis.consultantKnowledge),
      consultantKnowledge: analysis.consultantKnowledge || null,
      critique: analysis.critique || [],
      observationCount: analysis.observations?.length || 0
    },
    expectationModel: analysis.expectationModel || null,
    candidateObservations: analysis.observations || [],
    selectedObservation,
    emailVersions: emailVersions.map(({ draft, ...version }) => version)
  };
}

function fallbackDraft(lead, type, tone) {
  if (type === "EMAIL") return fallbackEmailDraft(lead, tone, senderProfile({ name: "Ocia Studio", email: "" }));
  const service = lead.serviceOpportunities?.[0];
  const serviceName = service?.service?.name || "website improvements";
  const issue = lead.issues?.[0]?.issueText || "a few conversion and trust opportunities on the site";
  const industry = industryContext(lead);
  const industryLabel = industry.mentionable ? `local ${industry.industry}` : "local business";
  const competitorStrengths = [
    ...new Set((lead.competitors || []).flatMap((competitor) => Array.isArray(competitor.strengths) ? competitor.strengths : []))
  ].slice(0, 2);
  const competitorAngle = competitorStrengths.length
    ? ` A few local competitors are already showing ${competitorStrengths.join(" and ").toLowerCase()}, which makes this a practical way to close the gap.`
    : "";
  const opener = `I was looking at ${lead.company}'s website and noticed ${issue}.`;
  const pitch = `We help ${industry.mentionable ? lead.industry : "local businesses"} turn those gaps into clearer pages, stronger calls to action, and more qualified enquiries.${competitorAngle} Based on the audit, ${serviceName} looks like the strongest first move${service ? ` because ${service.reason}` : "."}`;
  const isColdCall = type === "COLD_CALL";
  const cta = type === "LINKEDIN_DM"
    ? "Worth a quick chat this week?"
    : isColdCall
      ? "Would it be alright if I sent the quick notes over by email?"
      : "Would it be useful if I sent over 2-3 specific ideas for improving the site?";
  const subject = type === "EMAIL" ? `Quick idea for ${lead.company}` : null;
  if (isColdCall) {
    return {
      subject: null,
      opener: `Hi, is this the right person to speak with about ${lead.company}'s website?`,
      pitch: `I was reviewing ${industryLabel} websites and noticed ${issue}. We help teams turn those gaps into clearer pages, stronger trust signals, and more enquiries. ${serviceName} looks like the strongest first move${service ? ` because ${service.reason}` : "."}`,
      cta,
      fullMessage: [
        `Hi, is this the right person to speak with about ${lead.company}'s website?`,
        "",
        `I was reviewing ${industryLabel} websites and noticed ${issue}.`,
        "",
        `We help teams turn those gaps into clearer pages, stronger trust signals, and more enquiries. ${serviceName} looks like the strongest first move${service ? ` because ${service.reason}` : "."}`,
        "",
        cta
      ].join("\n"),
      tone
    };
  }
  return {
    subject,
    opener,
    pitch,
    cta,
    fullMessage: [subject ? `Subject: ${subject}` : null, opener, "", pitch, "", cta].filter((part) => part !== null).join("\n"),
    tone
  };
}

function normalizeGeneratedDraft(generated, lead, type, tone) {
  const fallback = fallbackDraft(lead, type, tone);
  const subject = type === "EMAIL" ? (generated.subject || fallback.subject || "") : "";
  const opener = generated.opener || fallback.opener || "";
  const pitch = generated.pitch || fallback.pitch || "";
  const cta = generated.cta || fallback.cta || "";
  const fullMessage = safeEmailText(generated.fullMessage || generated.emailBody || fallback.fullMessage || [subject ? `Subject: ${subject}` : null, opener, "", pitch, "", cta].filter((part) => part !== null).join("\n"));
  return {
    subject,
    compliment: generated.compliment || fallback.compliment || "",
    observation: generated.observation || fallback.observation || "",
    impact: generated.impact || fallback.impact || "",
    intro: generated.intro || fallback.intro || "",
    opener,
    pitch,
    cta,
    fullMessage,
    tone
  };
}

function storageType(type) {
  if (storedOutreachTypes.includes(type)) return type;
  return "FOLLOW_UP_2";
}

function storageSubject(type, subject) {
  if (type !== "COLD_CALL") return subject || null;
  return subject ? `${coldCallPrefix} ${subject}` : coldCallPrefix;
}

function displayDraft(draft) {
  if (!draft) return draft;
  const isColdCall = draft.subject?.startsWith(coldCallPrefix);
  return {
    ...draft,
    type: isColdCall ? "COLD_CALL" : draft.type,
    subject: isColdCall ? draft.subject.replace(coldCallPrefix, "").trim() : draft.subject
  };
}

function buildEmailPrompt({ lead, tone, sender, aiInput }) {
  return `Write one cold email for Ocia Studio.

Goal: make the recipient feel that we genuinely looked at their website for a few minutes.

Tone: ${tone || "natural, thoughtful, concise"}

Lead:
Company: ${aiInput.companyName}
Website: ${aiInput.websiteUrl}
${aiInput.industry ? `Industry: ${aiInput.industry}` : "Industry: not provided because confidence is below 0.8. Do not mention an industry or niche."}

Sender profile:
senderName: ${sender.senderName}
senderTitle: ${sender.senderTitle}
senderEmail: ${sender.senderEmail || "Not shown"}
companyName: ${sender.companyName}
signature:
${sender.signature}

Verified positive observations:
${aiInput.selectedCompliment ? `1. ${aiInput.selectedCompliment.compliment}\nEvidence trace: ${JSON.stringify(aiInput.selectedCompliment.trace || aiInput.selectedCompliment)}` : "None verified. Leave compliment empty and do not invent one."}

Selected evidence-backed business observation:
Type: ${aiInput.selectedObservation.type}
Observation: ${aiInput.selectedObservation.observation}
Impact: ${aiInput.selectedObservation.impact}
Business value: ${aiInput.selectedObservation.businessValue}
Evidence trace: ${JSON.stringify(aiInput.selectedObservation.trace || aiInput.selectedObservation)}

Return strict JSON only:
{
  "subject": "",
  "compliment": "",
  "observation": "",
  "impact": "",
  "intro": "",
  "cta": "",
  "emailBody": ""
}

Required email flow:
1. Personal greeting
2. Short introduction
3. Mention that we reviewed their website
4. One genuine verified compliment if available
5. One specific verified observation
6. Explain why it matters
7. Soft CTA
8. Signature

Use this rough structure, but make it read naturally:
Subject: Quick thought about ${lead.company}

Hi ${firstNameFromLead(lead)},

I'm ${sender.senderName} from ${sender.companyName}.

I spent a few minutes looking through ${lead.company}'s website earlier today and noticed something that felt worth sharing.

One thing I genuinely liked was:

{{compliment}}

One thing that stood out, though, was:

{{observation}}

{{impact}}

There were another couple of things I noticed that could be worth looking at too.

Would it be helpful if I sent them over?

Best,

${sender.signature}

Strict rules:
- 45 to 120 words.
- Natural English.
- Mention one observation only.
- Use the selected observation above. Do not create a different observation.
- Explain it as an interesting business opportunity, not as a generic missing-feature critique.
- Do not ask for a meeting.
- Do not mention PDFs, reports, attachments, scores, or tech stack.
- Do not use "increase revenue", "boost conversions", "industry-leading", "cutting-edge", "AI-powered", or hype.
- Do not fabricate compliments.
- Do not fabricate observations.
- Every business-specific claim must trace to the selected compliment or selected observation evidence above.
- If evidence is unknown or missing, do not mention it.`;
}

function buildPrompt({ lead, type, tone }) {
  const service = lead.serviceOpportunities?.[0];
  const issues = lead.issues?.map((issue) => issue.issueText).slice(0, 5).join("; ") || "No explicit issues saved.";
  const competitors = (lead.competitors || [])
    .slice(0, 3)
    .map((competitor) => {
      const strengths = Array.isArray(competitor.strengths) ? competitor.strengths.slice(0, 3).join(", ") : "Not audited yet";
      const weaknesses = Array.isArray(competitor.weaknesses) ? competitor.weaknesses.slice(0, 2).join(", ") : "None saved";
      return `${competitor.company} (${competitor.score}/10): strengths: ${strengths}; weaknesses: ${weaknesses}`;
    })
    .join("\n") || "No competitor comparison saved yet.";
  return `Create a personalized ${labelType(type)} outreach draft for a web agency.

Tone: ${tone || "consultative, concise, founder-led"}
Business: ${lead.company}
Website: ${lead.website}
${industryContext(lead).mentionable ? `Industry: ${industryContext(lead).industry}` : "Industry: not provided because confidence is below 0.8. Do not mention industry."}
Location: ${lead.location || lead.address || "Unknown"}
Audit score: ${lead.score}/10
Opportunity score: ${lead.opportunityScore || "Unknown"}/10
Website status: ${lead.websiteStatus}
Recommended service: ${service?.service?.name || "Website redesign"}
Service reason: ${service?.reason || "Use the audit issues to recommend the strongest first improvement."}
Estimated value: ${service ? `$${service.estimatedMinValue} - $${service.estimatedMaxValue}` : lead.estimatedProjectValue || "Unknown"}
Audit issues: ${issues}
Local competitor comparison:
${competitors}

Return strict JSON:
{
  "subject": "email subject or empty string for non-email or cold call",
  "opener": "personalized opener",
  "pitch": "short pitch tied to audit issue and recommended service",
  "cta": "low-friction CTA",
  "fullMessage": "complete ready-to-copy message"
}

Keep it natural, specific, and not spammy. For cold calls, write a spoken call script with short sentences. If competitor data exists, use it as the sales angle without naming competitors directly unless it feels natural. Do not mention AI, PDFs, attachments, or automated scanning.`;
}

async function generateWithOpenAI(context) {
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(context.lead, context.type, context.tone);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You write concise, personalized B2B outreach for a premium web agency. Return only valid JSON." },
      { role: "user", content: buildPrompt(context) }
    ],
    temperature: 0.45
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  return {
    subject: parsed.subject || null,
    opener: parsed.opener || "",
    pitch: parsed.pitch || "",
    cta: parsed.cta || "",
    fullMessage: parsed.fullMessage || [parsed.opener, parsed.pitch, parsed.cta].filter(Boolean).join("\n\n"),
    tone: context.tone
  };
}

function emailMentionsSuppressedIndustry(body, aiInput) {
  if (!aiInput.industrySuppressed || !aiInput.industry) return false;
  return String(body || "").toLowerCase().includes(String(aiInput.industry).toLowerCase());
}

function emailFailsQa(value) {
  const text = String(value || "");
  if (/one thing i (liked|noticed)|observation:|impact:/i.test(text)) return true;
  return bannedEmailPhrases.some((phrase) => {
    phrase.lastIndex = 0;
    return phrase.test(text);
  });
}

function parseGeneratedEmailVersions(parsed, fallbackVersions, aiInput, { lead, sender, tone }) {
  const sourceVersions = Array.isArray(parsed.emailVersions) && parsed.emailVersions.length
    ? parsed.emailVersions
    : [];
  const versions = ["Professional", "Friendly", "Curious"].map((style, index) => {
    const source = sourceVersions.find((item) => item.style === style) || sourceVersions[index] || {};
    const rewrittenObservation = safeEmailText(source.observation || aiInput.selectedObservation.description || aiInput.selectedObservation.title);
    const rewrittenImpact = safeEmailText(source.impact || aiInput.selectedObservation.impact || "");
    const rewriteUsesSuppressedIndustry = emailMentionsSuppressedIndustry(`${rewrittenObservation}\n${rewrittenImpact}`, aiInput);
    const version = composeEmailVersion({
      lead,
      sender,
      tone,
      selectedCompliment: aiInput.selectedCompliment,
      selectedObservation: aiInput.selectedObservation,
      rewrite: rewriteUsesSuppressedIndustry ? {} : {
        observation: rewrittenObservation,
        impact: rewrittenImpact
      },
      style
    });
    const subject = safeEmailText(source.subject || version.subject);
    return { ...version, subject: subject || version.subject };
  });
  const validVersions = versions.filter((item) => {
    const wordLimit = logEmailWordLimitQa(`outreach-draft:${item.style || "generated"}`, item.body);
    return wordLimit.withinWordLimit && !emailFailsQa(`${item.subject}\n${item.body}`);
  });
  fallbackVersions.forEach((item) => logEmailWordLimitQa(`outreach-draft:fallback:${item.style || "fallback"}`, item.body));
  return validVersions.length === 3 ? validVersions : fallbackVersions;
}

async function generateEmailWithOpenAI({ lead, tone, sender }) {
  const packet = evidencePacket(lead);
  const industry = industryContext(lead);
  const consultantKnowledge = await consultantKnowledgeForLead(lead, industry);
  const analysis = await analyseAndRankObservations({ lead, sender, industry, consultantKnowledge });
  const selectedObservation = analysis.selectedObservation;
  const selectedCompliment = worthwhileCompliment(packet, selectedObservation);
  const aiInput = emailAiInput({ lead, packet, selectedCompliment, selectedObservation, industry, analysis });
  logEmailAiInput(aiInput);
  assertValidEmailEvidence({ lead, selectedObservation, packet, industry });
  const fallbackVersions = fallbackEmailVersions({ lead, sender, tone, selectedCompliment, selectedObservation });
  if (!process.env.OPENAI_API_KEY) return emailResultFromVersions({ analysis, selectedObservation, emailVersions: fallbackVersions });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You write researched, natural cold emails for Ocia Studio. Use only verified evidence supplied by the user. Return strict JSON." },
        { role: "user", content: buildEmailWritingPrompt({ lead, sender, selectedObservation, selectedCompliment, industry }) }
      ],
      temperature: 0.55
    });
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    const emailVersions = parseGeneratedEmailVersions(parsed, fallbackVersions, aiInput, { lead, sender, tone });
    return emailResultFromVersions({ analysis, selectedObservation, emailVersions });
  } catch (error) {
    console.warn("[email-generation-stage4-fallback]", error.message);
    return emailResultFromVersions({ analysis, selectedObservation, emailVersions: fallbackVersions });
  }
}

async function leadContext(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      issues: { orderBy: { createdAt: "asc" } },
      evidenceCorrections: { orderBy: { updatedAt: "desc" } },
      industryRef: true,
      serviceOpportunities: {
        include: { service: true },
        orderBy: [{ recommended: "desc" }, { score: "desc" }]
      },
      competitors: { orderBy: { score: "desc" }, take: 3 }
    }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

export async function generateDraft(leadId, userId, input = {}) {
  const type = outreachTypes.includes(input.type) ? input.type : "EMAIL";
  const tone = input.tone || "consultative";
  const [lead, sender] = await Promise.all([leadContext(leadId), userSenderProfile(userId)]);
  let generated;
  if (type === "EMAIL") {
    try {
      generated = await generateEmailWithOpenAI({ lead, tone, sender });
    } catch (error) {
      if (error instanceof HttpError && error.details?.code === lowConfidenceCode) throw error;
      generated = fallbackEmailDraft(lead, tone, sender);
    }
  } else {
    generated = normalizeGeneratedDraft(
        await generateWithOpenAI({ lead, type, tone }).catch(() => fallbackDraft(lead, type, tone)),
        lead,
        type,
        tone
      );
  }

  const draft = await prisma.outreachDraft.create({
    data: {
      leadId,
      userId,
      type: storageType(type),
      subject: storageSubject(type, generated.subject),
      opener: generated.opener || "",
      pitch: generated.pitch || "",
      cta: generated.cta || "",
      fullMessage: generated.fullMessage || "",
      tone,
      status: "DRAFT"
    },
    include: { lead: { include: leadInclude }, user: { select: { id: true, name: true, email: true } } }
  });

  if (type === "EMAIL") {
    await prisma.lead.update({
      where: { id: leadId },
      data: { outreachEmail: draft.fullMessage, pipelineStage: "DRAFTED" }
    });
  }

  await prisma.leadNote.create({
    data: { leadId, userId, note: `Generated ${labelType(type)} outreach draft.` }
  });

  return {
    ...displayDraft(draft),
    ...(generated.analysis ? { analysis: generated.analysis } : {}),
    ...(generated.expectationModel ? { expectationModel: generated.expectationModel } : {}),
    ...(generated.candidateObservations ? { candidateObservations: generated.candidateObservations } : {}),
    ...(generated.selectedObservation ? { selectedObservation: generated.selectedObservation } : {}),
    ...(generated.emailVersions ? { emailVersions: generated.emailVersions } : {})
  };
}

export async function listDrafts(query = {}) {
  const leadFilters = {
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.industry && !query.industryId ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
  const where = {
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.type === "COLD_CALL" ? { subject: { startsWith: coldCallPrefix } } : {}),
    ...(query.type && query.type !== "COLD_CALL" ? { type: query.type, NOT: { subject: { startsWith: coldCallPrefix } } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(Object.keys(leadFilters).length ? { lead: leadFilters } : {})
  };
  const drafts = await prisma.outreachDraft.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(Number(query.limit || 80), 1), 150),
    include: {
      lead: { include: leadInclude },
      user: { select: { id: true, name: true, email: true } }
    }
  });
  return drafts.map(displayDraft);
}

export async function listLeadDrafts(leadId) {
  await leadContext(leadId);
  return listDrafts({ leadId, limit: 100 });
}

export async function updateDraft(id, input = {}) {
  const existing = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!existing) throw notFound("Outreach draft not found");
  const data = {
    ...(input.type && outreachTypes.includes(input.type) ? { type: storageType(input.type) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "subject") || input.type === "COLD_CALL" ? { subject: storageSubject(input.type || existing.type, input.subject) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "opener") ? { opener: input.opener || "" } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "pitch") ? { pitch: input.pitch || "" } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "cta") ? { cta: input.cta || "" } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "fullMessage") ? { fullMessage: input.fullMessage || "" } : {}),
    ...(input.status && statuses.includes(input.status) ? { status: input.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "tone") ? { tone: input.tone || null } : {})
  };
  if (!Object.keys(data).length) throw new HttpError(422, "No draft changes provided");
  const draft = await prisma.outreachDraft.update({
    where: { id },
    data,
    include: { lead: { include: leadInclude }, user: { select: { id: true, name: true, email: true } } }
  });
  if (draft.type === "EMAIL" && draft.fullMessage) {
    await prisma.lead.update({ where: { id: draft.leadId }, data: { outreachEmail: draft.fullMessage } });
  }
  if (data.status === "SENT") {
    await prisma.lead.update({ where: { id: draft.leadId }, data: { pipelineStage: "SENT", status: "CONTACTED" } });
  }
  return displayDraft(draft);
}

export async function deleteDraft(id) {
  const existing = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!existing) throw notFound("Outreach draft not found");
  await prisma.outreachDraft.delete({ where: { id } });
}

export async function getQueue(query = {}) {
  const where = {
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.industry && !query.industryId ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.serviceId ? { serviceOpportunities: { some: { serviceId: query.serviceId, recommended: true } } } : {})
  };
  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(Number(query.limit || 50), 1), 100),
    include: {
      industryRef: true,
      outreachDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
      serviceOpportunities: {
        where: { recommended: true },
        include: { service: true },
        take: 1
      }
    }
  });
  const rows = leads.map((lead) => {
    const state = lead.scanEvidence?.outreachPipeline || null;
    return {
      ...lead,
      pipelineWorkflow: state || { status: "NOT_ANALYSED", label: "Not Analysed" },
      pipelineWorkflowStatus: state?.status || "NOT_ANALYSED",
      pipelineConfidence: state?.confidence || null,
      pipelineQualityScore: state?.qualityScore || null,
      pipelineObservationCategory: state?.observationCategory || null
    };
  });
  if (query.pipelineWorkflowStatus) {
    return rows.filter((lead) => lead.pipelineWorkflowStatus === query.pipelineWorkflowStatus);
  }
  if (query.highConfidence === "true") {
    return rows.filter((lead) => Number(lead.pipelineConfidence || 0) >= 0.85);
  }
  if (query.needsReview === "true") {
    return rows.filter((lead) => ["NEEDS_REVIEW", "APPROVED"].includes(lead.pipelineWorkflowStatus));
  }
  return rows;
}
