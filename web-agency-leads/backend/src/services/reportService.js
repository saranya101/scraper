import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { DEFAULT_REPORT_SERVICE_IDS, REPORT_SERVICE_MAP, REPORT_SERVICE_OPTIONS } from "../constants/reportServiceOptions.js";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { runReportQualityGate } from "./reportQualityGate.js";
import { ensureReportScreenshots } from "./screenshotService.js";
import { absoluteUploadPath } from "./websiteScannerService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");
const uploadsRoot = path.resolve(backendRoot, "uploads");
const reportsRoot = path.resolve(uploadsRoot, "reports");
const CONTENT_BOTTOM = 730;

const agency = {
  name: "Ocia Studio",
  title: "Website Opportunity Report",
  subtitle: "A quick review of missed conversion, credibility, and user experience opportunities."
};

const serviceLenses = {
  website_redesign: {
    sectionSummary: "This section focuses on layout, messaging clarity, visual hierarchy, trust, and mobile usability.",
    evidenceTerms: ["hero", "homepage", "mobile", "layout", "navigation", "testimonial", "review", "trust", "cta", "design"],
    problems: [
      {
        title: "The homepage hero does not explain the main offer quickly enough",
        whyItMatters: "Visitors make a first-judgement decision in seconds. If the core service is vague above the fold, enquiry intent usually drops.",
        recommendedImprovement: "Rewrite the hero section with a clearer value proposition, service focus, location relevance, and one dominant primary CTA.",
        expectedImpact: "Visitors should understand faster what the business does and what action to take next."
      },
      {
        title: "Trust-building proof is not doing enough work near the decision points",
        whyItMatters: "If credentials, testimonials, or patient proof sit too far from the CTA, the site may feel less credible than alternatives.",
        recommendedImprovement: "Move reviews, credentials, before-and-after proof, or awards closer to the main enquiry and booking sections.",
        expectedImpact: "The site should feel more credible before visitors are asked to contact or book."
      },
      {
        title: "The page hierarchy does not guide visitors cleanly from interest to enquiry",
        whyItMatters: "When sections feel visually flat or poorly sequenced, important services and actions become easier to miss.",
        recommendedImprovement: "Re-order the page around buyer intent: offer clarity, proof, service explanation, then contact action, with stronger section spacing and mobile CTA visibility.",
        expectedImpact: "Important services become easier to scan and the route to enquiry becomes more deliberate."
      }
    ],
    actions: [
      "Rewrite the first screen around the clearest service promise and one main CTA.",
      "Add stronger proof elements near the first major contact point.",
      "Tighten mobile spacing and section order so high-intent visitors do not have to search."
    ]
  },
  seo: {
    sectionSummary: "This section focuses on search visibility, service relevance, on-page structure, and local SEO.",
    evidenceTerms: ["seo", "search", "local", "keyword", "heading", "meta", "service page", "content", "maps", "faq"],
    problems: [
      {
        title: "The website may not be sending enough local service relevance signals",
        whyItMatters: "If pages do not clearly combine service intent with location intent, the business may miss searches from nearby prospects.",
        recommendedImprovement: "Create or strengthen location-aware service headings, copy, and metadata around the highest-intent service plus location combinations.",
        expectedImpact: "Search engines should find it easier to connect the business to local service searches."
      },
      {
        title: "Important services may not have enough dedicated search-targeted content",
        whyItMatters: "Thin or overly generic service content makes it harder to rank for the searches that matter most.",
        recommendedImprovement: "Build dedicated service pages with stronger headings, FAQs, internal links, and service-specific copy written around real search intent.",
        expectedImpact: "Core services become easier to discover organically and easier for visitors to evaluate."
      },
      {
        title: "The site structure may not be helping search engines understand priority pages",
        whyItMatters: "Weak internal linking and limited content hierarchy can reduce visibility for the most valuable pages.",
        recommendedImprovement: "Link the homepage, service pages, FAQs, and trust content together more deliberately so the highest-value pages receive more context and authority.",
        expectedImpact: "Priority pages should become easier for both users and search engines to understand."
      }
    ],
    actions: [
      "Prioritise dedicated pages for the most commercially important services.",
      "Improve titles, headings, and local language around service plus location intent.",
      "Add FAQ and internal-linking support to strengthen search context."
    ]
  },
  conversion_rate_optimisation: {
    sectionSummary: "This section focuses on CTA clarity, friction reduction, trust near conversion points, and clearer next steps.",
    evidenceTerms: ["cta", "contact", "form", "booking", "whatsapp", "conversion", "trust", "above the fold"],
    problems: [
      {
        title: "Ready-to-enquire visitors may not know what to do next quickly enough",
        whyItMatters: "If the next step is unclear, traffic can reach the site but fail to turn into actual enquiries.",
        recommendedImprovement: "Introduce one clear primary CTA above the fold and repeat it consistently with action-led wording such as book, enquire, or request.",
        expectedImpact: "Visitors with intent should need less effort to move into contact."
      },
      {
        title: "The enquiry path may contain more friction than it should",
        whyItMatters: "Long forms, weak contact visibility, or too many choices can cause leads to drop before submission.",
        recommendedImprovement: "Shorten forms, reduce competing CTA patterns, and make phone or WhatsApp actions more visible on mobile.",
        expectedImpact: "The website should convert more interest into trackable enquiries."
      },
      {
        title: "Trust may not be reinforced strongly enough before the CTA",
        whyItMatters: "Visitors are more likely to delay action if proof and reassurance do not appear near the moment of decision.",
        recommendedImprovement: "Add credibility elements such as reviews, credentials, outcomes, or process reassurance directly beside enquiry and booking prompts.",
        expectedImpact: "Visitors should feel more confident taking the next step."
      }
    ],
    actions: [
      "Make the primary enquiry action unmistakable above the fold.",
      "Reduce form and navigation friction around conversion points.",
      "Add trust cues immediately beside the highest-value CTA."
    ]
  },
  branding_positioning: {
    sectionSummary: "This section focuses on value proposition clarity, differentiation, audience fit, and proof of why the business is worth choosing.",
    evidenceTerms: ["position", "message", "value", "brand", "offer", "trust", "proof", "service", "generic"],
    problems: [
      {
        title: "The site may not be explaining clearly who the business is best for",
        whyItMatters: "If the target audience is not obvious, visitors have to work harder to decide whether the offer is relevant.",
        recommendedImprovement: "Sharpen the headline, subheadline, and early copy around the customer type, service promise, and why the business is relevant.",
        expectedImpact: "The website should feel more specific and more aligned to the right visitors."
      },
      {
        title: "The business may be under-selling its strongest differentiators",
        whyItMatters: "Without visible reasons to choose this business, the website can blur into competitor alternatives.",
        recommendedImprovement: "Bring credentials, process advantages, specialist expertise, or outcome proof into earlier sections of the page.",
        expectedImpact: "Visitors should have a clearer reason to prefer this business over generic options."
      },
      {
        title: "The messaging may be too generic to build strong preference",
        whyItMatters: "Generic service language weakens differentiation and makes trust-building slower.",
        recommendedImprovement: "Rework the copy around the audience pain points, desired outcomes, and the most credible proof that the business can deliver.",
        expectedImpact: "The site should feel more memorable and more persuasive."
      }
    ],
    actions: [
      "Clarify the audience and main promise in the first screen.",
      "Surface differentiators and proof earlier in the journey.",
      "Refine copy so it sounds specific to the business rather than interchangeable."
    ]
  },
  google_business_profile: {
    sectionSummary: "This section focuses on local discovery, review trust, service-category visibility, and map-driven enquiries.",
    evidenceTerms: ["local", "review", "maps", "address", "hours", "location", "trust", "google"],
    problems: [
      {
        title: "Local trust signals may not be supporting map and local-search enquiries strongly enough",
        whyItMatters: "Weak review visibility or unclear location signals can reduce confidence before contact.",
        recommendedImprovement: "Make reviews, location details, service categories, and appointment actions more visible across the website and align them with Google Business Profile content.",
        expectedImpact: "The business should feel more credible to nearby searchers comparing local options."
      },
      {
        title: "Customers may not be getting enough quick local verification cues",
        whyItMatters: "If address, hours, phone, or appointment access are hard to confirm, local leads may choose simpler alternatives.",
        recommendedImprovement: "Surface contact details, hours, and directions more prominently and keep them consistent with local listings.",
        expectedImpact: "Visitors should be able to verify the business faster and act with less hesitation."
      },
      {
        title: "The website and local profile may not be working together as one conversion path",
        whyItMatters: "A disconnected local presence can make it harder to see which visits and calls come from local discovery.",
        recommendedImprovement: "Use stronger local CTAs, link tracking, and service alignment between the site and the business profile.",
        expectedImpact: "Local search traffic becomes easier to convert and easier to measure."
      }
    ],
    actions: [
      "Strengthen local trust proof and service consistency.",
      "Make address, contact, and appointment actions easier to verify.",
      "Connect local-profile visibility to measurable website actions."
    ]
  },
  lead_generation: {
    sectionSummary: "This section focuses on lead capture, enquiry pathways, softer conversion offers, and measurable follow-up.",
    evidenceTerms: ["lead", "enquiry", "form", "whatsapp", "capture", "consultation", "quote", "cta", "tracking"],
    problems: [
      {
        title: "The site may be relying too heavily on visitors contacting immediately",
        whyItMatters: "Not every interested visitor is ready to book or call on the first visit, so some leads may disappear untracked.",
        recommendedImprovement: "Add a consultation request, quote request, or softer lead-capture offer for visitors who want more information first.",
        expectedImpact: "More interested visitors should become trackable leads instead of bouncing."
      },
      {
        title: "There may not be enough visible lead-capture routes for mobile visitors",
        whyItMatters: "If visitors need to search for forms or contact options, enquiry volume can suffer.",
        recommendedImprovement: "Add a clearer WhatsApp prompt, shorter enquiry form, and stronger CTA placement on the first mobile screen and service sections.",
        expectedImpact: "Lead capture becomes easier for visitors who already show intent."
      },
      {
        title: "Lead generation activity may be hard to measure after the click",
        whyItMatters: "Without stronger tracking, it is harder to know which channels and pages create the best enquiries.",
        recommendedImprovement: "Track form submissions, call clicks, WhatsApp taps, and service-interest submissions as conversion events.",
        expectedImpact: "The business should gain clearer visibility into which lead sources are worth more attention."
      }
    ],
    actions: [
      "Add a softer lead-capture option for visitors not ready to book yet.",
      "Improve mobile visibility for form, phone, and WhatsApp actions.",
      "Measure every meaningful lead action so performance can be improved."
    ]
  },
  whatsapp_automation: {
    sectionSummary: "This section focuses on response speed, qualification, routing, and reducing lost enquiries in WhatsApp-driven workflows.",
    evidenceTerms: ["whatsapp", "reply", "automation", "follow-up", "enquiry", "qualification", "after-hours"],
    problems: [
      {
        title: "Leads may cool down if responses depend on manual reply speed",
        whyItMatters: "Visitors who enquire through WhatsApp often expect near-immediate confirmation or direction.",
        recommendedImprovement: "Set up instant WhatsApp auto-replies with clear next steps, service routing, and after-hours coverage.",
        expectedImpact: "The business should lose fewer warm leads while staff are unavailable."
      },
      {
        title: "Staff may be spending time answering repetitive questions that could be automated",
        whyItMatters: "Manual handling creates inconsistency and slows down the route to appointment or quote.",
        recommendedImprovement: "Use guided WhatsApp qualification prompts to capture service type, urgency, and contact details before human follow-up.",
        expectedImpact: "Enquiries reach the team in a more organised and higher-intent state."
      },
      {
        title: "There may be no structured follow-up when a WhatsApp enquiry does not convert immediately",
        whyItMatters: "Without reminders and re-engagement, some leads simply go cold after the first message.",
        recommendedImprovement: "Add automated follow-up prompts, appointment links, and reminder logic for enquiries that are opened but not completed.",
        expectedImpact: "The business should recover more value from partially engaged leads."
      }
    ],
    actions: [
      "Add instant acknowledgement and after-hours response coverage.",
      "Qualify service interest before human handover.",
      "Introduce reminders for unanswered or incomplete WhatsApp leads."
    ]
  },
  crm_lead_management: {
    sectionSummary: "This section focuses on lead tracking, follow-up consistency, pipeline visibility, and reducing missed opportunities after first contact.",
    evidenceTerms: ["crm", "lead", "tracking", "follow-up", "status", "pipeline", "reminder", "source"],
    problems: [
      {
        title: "The business may not have enough visibility into where each enquiry sits after first contact",
        whyItMatters: "Without clear stages, promising leads are easier to forget or delay.",
        recommendedImprovement: "Track each enquiry through simple stages such as new, contacted, booked, won, and lost, with service interest and urgency attached.",
        expectedImpact: "Follow-up decisions become easier to prioritise and less dependent on memory."
      },
      {
        title: "Manual follow-up habits can create avoidable lost-lead risk",
        whyItMatters: "Even strong leads can go cold if reminders and next actions are not visible.",
        recommendedImprovement: "Use follow-up reminders, owner assignment, and next-step dates so enquiries stay active until a clear outcome is reached.",
        expectedImpact: "The business should lose fewer leads simply because follow-up slipped."
      },
      {
        title: "Lead-source quality may be difficult to compare across channels",
        whyItMatters: "If source and outcome are not linked, it is harder to know which marketing activity is producing the best leads.",
        recommendedImprovement: "Capture lead source, service interest, and outcome in one place for form, WhatsApp, call, and booking enquiries.",
        expectedImpact: "The team gains clearer pipeline visibility and stronger channel-level decision-making."
      }
    ],
    actions: [
      "Implement a simple visible pipeline with enquiry stages.",
      "Add reminders and ownership so warm leads do not stall.",
      "Track source and outcome together for better channel visibility."
    ]
  },
  ai_chatbot: {
    sectionSummary: "This section focuses on FAQ coverage, 24/7 response, service guidance, and chatbot-to-human lead handoff.",
    evidenceTerms: ["chat", "faq", "response", "question", "guide", "lead", "qualification"],
    problems: [
      {
        title: "Visitors may leave when they cannot get quick answers to basic questions",
        whyItMatters: "If questions about services, suitability, or next steps are unanswered, some prospects will not continue.",
        recommendedImprovement: "Deploy a chatbot that can answer the most common service questions and guide visitors toward the right next step.",
        expectedImpact: "The site should keep more uncertain visitors engaged long enough to convert them."
      },
      {
        title: "The team may be repeating the same explanations instead of qualifying leads earlier",
        whyItMatters: "Repetitive manual responses slow down follow-up and reduce consistency.",
        recommendedImprovement: "Use guided chatbot flows to capture the visitor’s service need, urgency, and contact details before handover.",
        expectedImpact: "Human follow-up starts with better context and less repetition."
      },
      {
        title: "After-hours visitors may have no assisted path into the enquiry journey",
        whyItMatters: "Traffic outside working hours can still show strong intent, but only if the site can respond usefully.",
        recommendedImprovement: "Offer chatbot-led FAQs, booking handoff, or enquiry capture that continues even when staff are offline.",
        expectedImpact: "The business should preserve more value from off-hours traffic."
      }
    ],
    actions: [
      "Cover the highest-frequency service questions automatically.",
      "Qualify visitors before human handoff.",
      "Keep after-hours traffic moving into a clear next step."
    ]
  },
  appointment_booking: {
    sectionSummary: "This section focuses on reducing booking friction, giving visitors a faster path to scheduling, and reducing coordination overhead.",
    evidenceTerms: ["booking", "appointment", "calendar", "reminder", "schedule", "consultation"],
    problems: [
      {
        title: "Potential customers may delay booking if they cannot schedule quickly online",
        whyItMatters: "The longer the path between intent and appointment, the more drop-off risk increases.",
        recommendedImprovement: "Add clearer online appointment booking paths that let visitors choose a slot without waiting for manual coordination.",
        expectedImpact: "Visitors should be able to turn intent into action faster."
      },
      {
        title: "Manual scheduling can consume time that should be spent on service delivery",
        whyItMatters: "Back-and-forth scheduling creates avoidable admin work and slows confirmations.",
        recommendedImprovement: "Connect booking flows to a live calendar with service-specific appointment choices and automated confirmation logic.",
        expectedImpact: "The team spends less time coordinating and more time handling qualified appointments."
      },
      {
        title: "No-show risk may stay higher without a reminder and rescheduling flow",
        whyItMatters: "Bookings are more fragile when reminders and rebooking routes are unclear.",
        recommendedImprovement: "Add email, SMS, or WhatsApp reminders along with easy rescheduling links and service instructions.",
        expectedImpact: "The appointment pipeline should become more reliable and easier to manage."
      }
    ],
    actions: [
      "Make booking the clearest next step for ready visitors.",
      "Reduce manual scheduling through live calendar connection.",
      "Protect confirmed appointments with reminders and rescheduling logic."
    ]
  },
  ecommerce_improvement: {
    sectionSummary: "This section focuses on product trust, purchase flow, checkout friction, and revenue leakage in the buying journey.",
    evidenceTerms: ["product", "checkout", "cart", "purchase", "pricing", "delivery", "returns", "review"],
    problems: [
      {
        title: "Product decision pages may not be doing enough to create confidence before purchase",
        whyItMatters: "Weak product structure, proof, or explanation increases abandonment before checkout.",
        recommendedImprovement: "Strengthen product pages with better benefit-led descriptions, supporting visuals, proof, and clearer delivery or returns information.",
        expectedImpact: "Shoppers should feel more confident progressing toward checkout."
      },
      {
        title: "Checkout friction may be costing purchases after intent is already established",
        whyItMatters: "Even small barriers near checkout can create meaningful revenue leakage.",
        recommendedImprovement: "Simplify the purchase flow, reduce unnecessary steps, and surface reassurance such as payment trust, delivery clarity, and returns information.",
        expectedImpact: "More baskets should turn into completed purchases."
      },
      {
        title: "The store may not be recovering enough value from partially completed shopping journeys",
        whyItMatters: "Some customers will leave before buying unless the site has a recovery path.",
        recommendedImprovement: "Add cart recovery, stronger review visibility, and better reminder flows for undecided shoppers.",
        expectedImpact: "The business should recover more value from near-purchase visitors."
      }
    ],
    actions: [
      "Improve product-page trust and explanation quality.",
      "Reduce checkout friction around the final decision point.",
      "Recover more abandoned purchase journeys with follow-up logic."
    ]
  },
  social_media_content: {
    sectionSummary: "This section focuses on trust-building content, educational proof, and using social content to support the website journey.",
    evidenceTerms: ["social", "content", "testimonial", "case study", "education", "trust", "awareness", "proof"],
    problems: [
      {
        title: "The business may not be creating enough supporting proof before visitors enquire",
        whyItMatters: "Many prospects need repeated trust cues and education before they are ready to contact a business.",
        recommendedImprovement: "Build content around FAQs, case studies, testimonials, and educational explanations that support the same services promoted on the website.",
        expectedImpact: "The brand should feel more credible and more familiar before the enquiry step."
      },
      {
        title: "Website and social proof may not be reinforcing each other strongly enough",
        whyItMatters: "If trust-building content stays disconnected, visitors do not receive a consistent proof journey.",
        recommendedImprovement: "Bring reviews, client stories, and educational snippets into both the website and the social content funnel.",
        expectedImpact: "The business should benefit from a more connected trust-building experience."
      },
      {
        title: "Potential customers may not be seeing enough helpful content to understand the service value",
        whyItMatters: "Without regular education, service awareness and confidence can stay weaker than it needs to be.",
        recommendedImprovement: "Repurpose service FAQs, objections, and outcomes into a repeatable social content plan linked back to the site.",
        expectedImpact: "The audience should have clearer reasons to remember and trust the business."
      }
    ],
    actions: [
      "Turn website FAQs and objections into repeatable content topics.",
      "Use case-study and testimonial content to support credibility.",
      "Link social proof back to key service pages and enquiry steps."
    ]
  }
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sentence(value) {
  const next = clean(value);
  if (!next) return "";
  return /[.!?]$/.test(next) ? next : `${next}.`;
}

function textArray(value) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function safeCompanySlug(company) {
  return clean(company).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "website-report";
}

function normalizeSelectedServiceIds(input) {
  const source = Array.isArray(input) ? input : Array.isArray(input?.selectedServices) ? input.selectedServices : [];
  const ids = [...new Set(source.map((item) => typeof item === "string" ? item : item?.id).filter((id) => REPORT_SERVICE_MAP.has(id)))];
  return ids.length ? ids : [...DEFAULT_REPORT_SERVICE_IDS];
}

function selectedServiceObjects(input) {
  return normalizeSelectedServiceIds(input).map((id) => REPORT_SERVICE_MAP.get(id));
}

function scoreSummary(lead) {
  const opportunityScore = Number(lead.opportunityScore || lead.score || 6);
  const confidenceScore = Math.max(55, Math.min(96, Number(lead.contactConfidence || opportunityScore * 10 || 72)));
  return { opportunityScore, confidenceScore };
}

function evidencePool(lead, screenshotData) {
  const issueTexts = textArray((lead.issues || []).map((item) => item.issueText));
  const fixTexts = textArray((lead.recommendedFixes || []).map((item) => typeof item === "string" ? item : item?.title || item?.details || item?.description));
  const general = [
    lead.websiteStatus && lead.websiteStatus !== "WORKING"
      ? sentence(`Website status detected during analysis: ${lead.websiteStatus.toLowerCase().replaceAll("_", " ")}.`)
      : "",
    lead.accessIssueReason ? sentence(lead.accessIssueReason) : "",
    lead.cms ? sentence(`Detected platform: ${lead.cms}.`) : "",
    lead.analyticsGa4 || lead.analyticsGtm ? "Analytics tooling was detected, but conversion tracking depth was not confirmed." : "",
    lead.bookingCalendly || lead.bookingSimplyBook || lead.bookingAcuity ? "A booking tool appears to be present on the site." : "",
    lead.whatsapp ? "A WhatsApp contact route is available." : "",
    lead.generalEmail || lead.ownerEmail ? "An email contact path is available." : ""
  ].map(clean).filter(Boolean);
  return { issueTexts, fixTexts, general };
}

function evidenceForService(pool, serviceId) {
  const lens = serviceLenses[serviceId];
  const terms = lens?.evidenceTerms || [];
  const direct = [...pool.issueTexts, ...pool.fixTexts].filter((item) => {
    const lower = item.toLowerCase();
    return terms.some((term) => lower.includes(term));
  });
  return direct.length ? direct : pool.issueTexts.length ? pool.issueTexts : pool.general;
}

function confidenceFromLead(lead, index = 0) {
  const baseline = Number(lead.contactConfidence || lead.opportunityScore || 72);
  return Math.max(58, Math.min(96, baseline - index * 5));
}

function severityFromEvidence(text, index = 0) {
  const value = clean(text).toLowerCase();
  if (index === 0 || /hero|homepage|cta|enquiry|booking|lead|search|trust|mobile|reply|follow-up/.test(value)) return "high";
  if (/content|meta|faq|review|calendar|tracking|proof|social/.test(value)) return "medium";
  return "low";
}

function injectBusinessContext(text, lead) {
  return sentence(String(text || "").replace(/\bthe business\b/gi, clean(lead.company) || "the business"));
}

function buildProblemFromTemplate(lead, serviceId, template, evidenceText, index, screenshotData) {
  const screenshotPath = index === 0
    ? screenshotData.screenshots.homepage || screenshotData.screenshots.mobile || undefined
    : index === 1
      ? screenshotData.screenshots.mobile || screenshotData.screenshots.homepage || undefined
      : undefined;
  return {
    title: template.title,
    severity: severityFromEvidence(evidenceText || template.title, index),
    confidence: confidenceFromLead(lead, index),
    evidence: [sentence(evidenceText || "The current crawl did not return a stronger service-specific issue, so this recommendation is based on visible website signals and the existing audit notes.")],
    whyItMatters: injectBusinessContext(template.whyItMatters, lead),
    recommendedImprovement: injectBusinessContext(template.recommendedImprovement, lead),
    expectedImpact: injectBusinessContext(template.expectedImpact, lead),
    screenshotPath
  };
}

function buildServiceSection(lead, service, pool, screenshotData) {
  const lens = serviceLenses[service.id];
  const serviceEvidence = evidenceForService(pool, service.id);
  const limitedEvidence = serviceEvidence.length < 2;
  const problems = lens.problems.slice(0, 3).map((template, index) =>
    buildProblemFromTemplate(lead, service.id, template, serviceEvidence[index] || serviceEvidence[0], index, screenshotData)
  );
  const priorityActions = lens.actions.slice(0, 3).map((action, index) => ({
    action: sentence(action),
    priority: index === 0 ? "high" : index === 1 ? "medium" : "low",
    reason: sentence(problems[index]?.whyItMatters || "This action addresses a visible source of friction in the current journey.")
  }));
  return {
    serviceId: service.id,
    serviceLabel: service.label,
    serviceSummary: limitedEvidence
      ? `${lens.sectionSummary} Limited ${service.label}-specific evidence was available from the current crawl, so this section focuses on visible on-page opportunities only.`
      : lens.sectionSummary,
    businessProblems: problems,
    priorityActions
  };
}

function buildExecutiveSummary(lead, selectedServices, serviceSections, scores) {
  const focusLabels = selectedServices.map((item) => item.label);
  const topProblems = serviceSections.flatMap((section) => section.businessProblems.slice(0, 1).map((problem) => problem.title)).slice(0, 3);
  return {
    text: [
      `${lead.company}'s report was generated around ${focusLabels.join(", ")}, rather than as a generic website audit.`,
      `Across the selected services, the highest-priority problems relate to ${topProblems.join(", ").toLowerCase()}.`,
      "The aim of this report is to show where the business may be losing clarity, trust, search visibility, or lead momentum for the exact services being considered."
    ].join(" "),
    topProblems
  };
}

function buildFinalActionPlan(serviceSections) {
  const actions = serviceSections.flatMap((section) =>
    section.priorityActions.slice(0, 1).map((item) => ({
      title: `${section.serviceLabel}: ${item.action.replace(/[.]$/, "")}`,
      description: item.reason
    }))
  ).slice(0, 3);
  while (actions.length < 3) {
    actions.push({
      title: "Review service-specific improvements with the business owner",
      description: "Use the evidence from the report to agree the highest-value next move before implementation starts."
    });
  }
  return actions.map((item, index) => ({
    step: index + 1,
    title: item.title,
    description: item.description
  }));
}

function flattenServiceProblems(serviceSections) {
  return serviceSections.flatMap((section) =>
    section.businessProblems.map((problem) => ({
      ...problem,
      serviceId: section.serviceId,
      serviceLabel: section.serviceLabel
    }))
  );
}

function buildDeterministicReport(lead, screenshotData, selectedServices) {
  const scores = scoreSummary(lead);
  const pool = evidencePool(lead, screenshotData);
  const serviceSections = selectedServices.map((service) => buildServiceSection(lead, service, pool, screenshotData));
  const executive = buildExecutiveSummary(lead, selectedServices, serviceSections, scores);
  return {
    lead: {
      businessName: lead.company,
      websiteUrl: lead.website,
      industry: lead.industryRef?.name || lead.industry || "Professional Services"
    },
    selectedServices: selectedServices.map((item) => ({ id: item.id, label: item.label, description: item.description })),
    generatedDate: new Date().toISOString(),
    reportTitle: agency.title,
    subtitle: agency.subtitle,
    agency,
    scores,
    executiveSummary: executive.text,
    topProblems: executive.topProblems,
    topRecommendations: serviceSections.flatMap((section) => section.priorityActions.slice(0, 1).map((item) => item.action)).slice(0, 3),
    serviceSections,
    finalActionPlan: buildFinalActionPlan(serviceSections),
    cta: "If useful, I can walk you through the highest-priority service opportunities and outline a practical next-step plan on a short call.",
    debug: {
      source: "deterministic-fallback",
      screenshotStatus: screenshotData.status,
      screenshotWarnings: screenshotData.warnings || []
    }
  };
}

async function buildAiStructuredReport(lead, screenshotData, selectedServices) {
  if (!process.env.OPENAI_API_KEY) return null;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const base = buildDeterministicReport(lead, screenshotData, selectedServices);
  const promptInput = {
    lead: base.lead,
    selectedServices: base.selectedServices,
    scores: base.scores,
    websiteStatus: lead.websiteStatus,
    accessIssue: lead.accessIssue,
    accessIssueReason: lead.accessIssueReason,
    evidence: evidencePool(lead, screenshotData),
    screenshots: screenshotData,
    baselineServiceSections: base.serviceSections
  };
  const schemaHint = {
    lead: { businessName: "string", websiteUrl: "string", industry: "string" },
    selectedServices: [{ id: "string", label: "string" }],
    generatedDate: "ISO string",
    reportTitle: "string",
    subtitle: "string",
    scores: { opportunityScore: "number", confidenceScore: "number" },
    executiveSummary: "string",
    serviceSections: [{
      serviceId: "string",
      serviceLabel: "string",
      serviceSummary: "string",
      businessProblems: [{
        title: "string",
        severity: "high|medium|low",
        confidence: "number",
        evidence: ["string"],
        whyItMatters: "string",
        recommendedImprovement: "string",
        expectedImpact: "string",
        screenshotPath: "string optional"
      }],
      priorityActions: [{
        action: "string",
        priority: "high|medium|low",
        reason: "string"
      }]
    }],
    finalActionPlan: [{
      step: "number",
      title: "string",
      description: "string"
    }],
    cta: "string"
  };
  const timeoutMs = Number(process.env.REPORT_AI_TIMEOUT_MS || 20000);
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "You generate evidence-backed service-specific website opportunity reports. Use only the supplied evidence, focus only on the selected services, avoid generic recommendations, avoid invented metrics, and return valid JSON only."
      },
      {
        role: "user",
        content: `Create a structured service-based website opportunity report.\nSchema:\n${JSON.stringify(schemaHint, null, 2)}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
      }
    ]
  }, {
    timeout: timeoutMs,
    signal: AbortSignal.timeout(timeoutMs + 1000)
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  return {
    ...base,
    ...parsed,
    agency,
    selectedServices: selectedServices.map((item) => ({ id: item.id, label: item.label, description: item.description })),
    debug: {
      source: "openai-structured-json",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      screenshotStatus: screenshotData.status,
      screenshotWarnings: screenshotData.warnings || []
    }
  };
}

async function buildStructuredReport(lead, screenshotData, selectedServices) {
  try {
    return (await buildAiStructuredReport(lead, screenshotData, selectedServices)) || buildDeterministicReport(lead, screenshotData, selectedServices);
  } catch (error) {
    const fallback = buildDeterministicReport(lead, screenshotData, selectedServices);
    fallback.debug = {
      ...(fallback.debug || {}),
      aiFallbackReason: error.message || "AI report generation failed."
    };
    return fallback;
  }
}

function normalizeProblem(problem, fallbackScreenshotPath) {
  return {
    ...problem,
    title: clean(problem.title),
    evidence: textArray(problem.evidence),
    whyItMatters: sentence(problem.whyItMatters),
    recommendedImprovement: sentence(problem.recommendedImprovement),
    expectedImpact: sentence(problem.expectedImpact),
    confidence: Number(problem.confidence || 0),
    screenshotPath: problem.screenshotPath || fallbackScreenshotPath || undefined
  };
}

function drawHeaderFooter(doc, report, pageNumber) {
  const width = doc.page.width;
  const height = doc.page.height;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text(report.lead.businessName, 48, 28);
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(report.lead.websiteUrl, 48, 42, { width: width - 96 });
  doc.moveTo(48, 58).lineTo(width - 48, 58).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.moveTo(48, height - 48).lineTo(width - 48, height - 48).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(`${agency.name} • ${agency.title}`, 48, height - 37, { width: 300 });
  doc.text(`Page ${pageNumber}`, width - 108, height - 37, { width: 60, align: "right" });
}

function drawParagraph(doc, text, x, y, width, options = {}) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size || 11).fillColor(options.color || "#334155").text(text, x, y, {
    width,
    lineGap: options.lineGap ?? 4
  });
  return doc.y;
}

function measureTextHeight(doc, text, width, options = {}) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size || 11);
  return doc.heightOfString(text, {
    width,
    lineGap: options.lineGap ?? 4
  });
}

function drawSectionTitle(doc, label, title, y) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#2563eb").text(label.toUpperCase(), 48, y, { characterSpacing: 1.1 });
  doc.font("Helvetica-Bold").fontSize(24).fillColor("#0f172a").text(title, 48, y + 16, { width: 500 });
  return doc.y;
}

function ensurePageSpace(doc, report, pageState, currentY, neededHeight, redrawSection) {
  if (currentY + neededHeight <= CONTENT_BOTTOM) return currentY;
  doc.addPage();
  pageState.pageNumber += 1;
  drawHeaderFooter(doc, report, pageState.pageNumber);
  return redrawSection ? redrawSection() : 80;
}

function drawBadge(doc, label, value, x, y, color = "#0f172a", soft = "#e2e8f0") {
  const text = `${label}: ${value}`;
  const width = Math.max(88, doc.widthOfString(text) + 18);
  doc.roundedRect(x, y, width, 22, 11).fillAndStroke(soft, soft);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(color).text(text, x + 9, y + 7);
  return width;
}

function drawPill(doc, x, y, text, options = {}) {
  const width = Math.max(70, doc.widthOfString(text) + 20);
  doc.roundedRect(x, y, width, 22, 11).fillAndStroke(options.fill || "#e2e8f0", options.fill || "#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(9).fillColor(options.color || "#334155").text(text, x + 10, y + 7);
  return width;
}

function drawImageIfPresent(doc, uploadUrl, x, y, width, height, caption) {
  doc.roundedRect(x, y, width, height, 16).fillAndStroke("#f8fafc", "#e2e8f0");
  if (!uploadUrl) {
    doc.font("Helvetica").fontSize(10).fillColor("#94a3b8").text(caption || "Evidence preview unavailable", x + 16, y + height / 2 - 6, { width: width - 32, align: "center" });
    return;
  }
  try {
    const filePath = absoluteUploadPath(uploadUrl);
    doc.save();
    doc.roundedRect(x + 2, y + 2, width - 4, height - 4, 14).clip();
    doc.image(filePath, x + 2, y + 2, { fit: [width - 4, height - 4], align: "center", valign: "center" });
    doc.restore();
    if (caption) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(caption, x, y + height + 6, { width, align: "center" });
    }
  } catch {
    doc.font("Helvetica").fontSize(10).fillColor("#94a3b8").text(caption || "Evidence preview unavailable", x + 16, y + height / 2 - 6, { width: width - 32, align: "center" });
  }
}

function coverBusinessNameStyle(name) {
  const value = clean(name);
  if (value.length > 42) return { size: 24, lineGap: 4 };
  if (value.length > 32) return { size: 27, lineGap: 4 };
  return { size: 32, lineGap: 3 };
}

function fitCoverTitleSize(doc, textWidth) {
  let size = 36;
  while (size > 28) {
    doc.font("Helvetica-Bold").fontSize(size);
    if (doc.widthOfString("Website Opportunity") <= textWidth) return size;
    size -= 1;
  }
  return size;
}

function drawCoverPage(doc, report) {
  const pageWidth = doc.page.width;
  const left = 48;
  const contentWidth = pageWidth - left * 2;
  doc.rect(0, 0, pageWidth, doc.page.height).fill("#ffffff");

  const topNameStyle = coverBusinessNameStyle(report.lead.businessName);
  let y = 70;
  doc.font("Helvetica-Bold").fontSize(Math.max(18, topNameStyle.size - 8)).fillColor("#0f172a").text(report.lead.businessName, left, y, {
    width: contentWidth,
    lineGap: 2
  });
  y = doc.y + 8;
  doc.font("Helvetica").fontSize(11).fillColor("#64748b").text(report.lead.websiteUrl, left, y, { width: contentWidth });
  y = doc.y + 16;
  doc.moveTo(left, y).lineTo(pageWidth - left, y).strokeColor("#d7e0ec").lineWidth(1).stroke();

  const heroY = y + 38;
  const heroW = contentWidth;
  const heroH = 320;
  const heroPaddingX = 32;
  const heroPaddingY = 40;
  const previewW = 140;
  const previewH = 190;
  const heroGap = 24;
  const previewCardX = left + heroW - heroPaddingX - previewW;
  const previewCardY = heroY + 34;
  const textX = left + heroPaddingX;
  const textW = previewCardX - textX - heroGap;

  doc.roundedRect(left, heroY, heroW, heroH, 32).fill("#f5f7fb");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#2563eb").text(report.agency.name.toUpperCase(), textX, heroY + heroPaddingY, {
    characterSpacing: 1.6
  });
  const titleY = heroY + heroPaddingY + 34;
  const titleSize = fitCoverTitleSize(doc, textW);
  doc.font("Helvetica-Bold").fontSize(titleSize).fillColor("#0f172a").text("Website Opportunity\nReport", textX, titleY, {
    width: textW,
    lineGap: 3
  });
  const subtitleY = doc.y + 16;
  doc.font("Helvetica").fontSize(16).fillColor("#475569").text("Identifying key areas for improvement", textX, subtitleY, { width: textW, lineGap: 5 });

  let badgeX = textX;
  let badgeY = doc.y + 20;
  report.selectedServices.forEach((service) => {
    const pillWidth = Math.max(72, doc.widthOfString(service.label) + 20);
    if (badgeX + pillWidth > previewCardX - 12) {
      badgeX = textX;
      badgeY += 28;
    }
    drawPill(doc, badgeX, badgeY, service.label, { fill: "#dbeafe", color: "#1d4ed8" });
    badgeX += pillWidth + 8;
  });

  drawImageIfPresent(doc, report.serviceSections[0]?.businessProblems[0]?.screenshotPath, previewCardX, previewCardY, previewW, previewH, "Homepage evidence");

  const detailY = heroY + heroH + 48;
  const detailStyle = coverBusinessNameStyle(report.lead.businessName);
  doc.font("Helvetica-Bold").fontSize(detailStyle.size).fillColor("#0f172a").text(report.lead.businessName, left, detailY, {
    width: contentWidth,
    lineGap: detailStyle.lineGap
  });
  const websiteY = doc.y + 12;
  doc.font("Helvetica").fontSize(11).fillColor("#64748b").text(report.lead.websiteUrl, left, websiteY, { width: contentWidth });
  const industryY = doc.y + 14;
  doc.font("Helvetica").fontSize(11).fillColor("#64748b").text(report.lead.industry, left, industryY, { width: contentWidth });
  doc.text(new Date(report.generatedDate).toLocaleDateString(), left, industryY + 20, { width: contentWidth });
  drawHeaderFooter(doc, report, 1);
}

function drawExecutiveSummaryPage(doc, report, pageNumber) {
  drawHeaderFooter(doc, report, pageNumber);
  let y = drawSectionTitle(doc, "Executive Summary", "What this report focuses on", 80) + 18;
  y = drawParagraph(doc, report.executiveSummary, 48, y, 500, { size: 12, color: "#334155", lineGap: 6 }) + 24;
  doc.roundedRect(48, y, 500, 108, 18).fillAndStroke("#ffffff", "#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Selected services", 66, y + 18);
  let badgeX = 66;
  let badgeY = y + 48;
  report.selectedServices.forEach((service) => {
    const pillWidth = Math.max(72, doc.widthOfString(service.label) + 20);
    if (badgeX + pillWidth > 520) {
      badgeX = 66;
      badgeY += 28;
    }
    drawPill(doc, badgeX, badgeY, service.label, { fill: "#eff6ff", color: "#1d4ed8" });
    badgeX += pillWidth + 8;
  });
  y += 132;
  const listOptions = { size: 10.5, color: "#334155", lineGap: 5 };
  const topProblemLines = report.topProblems.slice(0, 3).map((item) => `• ${item}`);
  const recommendationLines = report.finalActionPlan.slice(0, 3).map((step) => `${step.step}. ${step.title}`);
  const leftHeights = topProblemLines.map((line) => measureTextHeight(doc, line, 196, listOptions));
  const rightHeights = recommendationLines.map((line) => measureTextHeight(doc, line, 196, listOptions));
  const leftContentH = leftHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, leftHeights.length - 1) * 10;
  const rightContentH = rightHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rightHeights.length - 1) * 10;
  const summaryCardsH = Math.max(150, Math.ceil(Math.max(48 + leftContentH, 48 + rightContentH) + 24));
  doc.roundedRect(48, y, 240, summaryCardsH, 18).fillAndStroke("#ffffff", "#e2e8f0");
  doc.roundedRect(308, y, 240, summaryCardsH, 18).fillAndStroke("#ffffff", "#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Top problems across selected services", 66, y + 18);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Recommended priority order", 326, y + 18);
  let leftY = y + 48;
  topProblemLines.forEach((line) => {
    leftY = drawParagraph(doc, line, 66, leftY, 196, listOptions) + 10;
  });
  let rightY = y + 48;
  recommendationLines.forEach((line) => {
    rightY = drawParagraph(doc, line, 326, rightY, 196, listOptions) + 10;
  });
}

function drawServicePage(doc, report, section, index, pageState) {
  const drawSectionIntro = (continued = false) => {
    const title = continued ? `${section.serviceLabel} (continued)` : section.serviceLabel;
    let nextY = drawSectionTitle(doc, `Service Opportunity ${String(index + 1).padStart(2, "0")}`, title, 80) + 18;
    if (!continued) nextY = drawParagraph(doc, section.serviceSummary, 48, nextY, 500, { size: 12, color: "#334155", lineGap: 6 }) + 18;
    else nextY += 4;
    return nextY;
  };

  drawHeaderFooter(doc, report, pageState.pageNumber);
  let y = drawSectionIntro(false);
  section.businessProblems.slice(0, 2).forEach((problem) => {
    const titleOptions = { size: 13, bold: true, lineGap: 4 };
    const evidenceOptions = { size: 10.2, color: "#475569", lineGap: 5 };
    const bodyOptions = { size: 10.2, color: "#334155", lineGap: 6 };
    const improvementOptions = { size: 9.9, color: "#334155", lineGap: 6 };
    const titleH = measureTextHeight(doc, problem.title, 250, titleOptions);
    const evidenceText = `Evidence: ${problem.evidence.join(" ")}`;
    const evidenceH = measureTextHeight(doc, evidenceText, 250, evidenceOptions);
    const whyText = `Why it matters: ${problem.whyItMatters}`;
    const whyH = measureTextHeight(doc, whyText, 250, bodyOptions);
    const improvementText = `Recommended improvement: ${problem.recommendedImprovement}`;
    const improvementH = measureTextHeight(doc, improvementText, 452, improvementOptions);
    const textHeight = 48 + titleH + 14 + evidenceH + 14 + whyH + 18 + improvementH + 22;
    const imageHeight = 18 + 96 + 22;
    const cardH = Math.max(220, Math.ceil(Math.max(textHeight, imageHeight)));
    y = ensurePageSpace(doc, report, pageState, y, cardH, () => drawSectionIntro(true));
    const cardY = y;
    doc.roundedRect(48, cardY, 500, cardH, 18).fillAndStroke("#ffffff", "#e2e8f0");
    const sevWidth = drawBadge(doc, "Severity", problem.severity.toUpperCase(), 66, cardY + 18, problem.severity === "high" ? "#991b1b" : problem.severity === "medium" ? "#92400e" : "#166534", problem.severity === "high" ? "#fee2e2" : problem.severity === "medium" ? "#fef3c7" : "#dcfce7");
    drawBadge(doc, "Confidence", `${problem.confidence}/100`, 66 + sevWidth + 10, cardY + 18, "#1d4ed8", "#dbeafe");
    const titleY = cardY + 48;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(problem.title, 66, titleY, { width: 250, lineGap: 4 });
    const evidenceY = titleY + titleH + 14;
    drawParagraph(doc, evidenceText, 66, evidenceY, 250, evidenceOptions);
    const whyY = evidenceY + evidenceH + 14;
    drawParagraph(doc, whyText, 66, whyY, 250, bodyOptions);
    drawImageIfPresent(doc, problem.screenshotPath, 356, cardY + 18, 162, 96);
    const improvementY = whyY + whyH + 18;
    drawParagraph(doc, improvementText, 66, improvementY, 452, improvementOptions);
    y += cardH + 14;
  });
  const actions = section.priorityActions.slice(0, 3);
  const actionOptions = { size: 9.8, color: "#334155", lineGap: 5 };
  const actionHeights = actions.map((item, itemIndex) => measureTextHeight(doc, `${itemIndex + 1}. ${item.action}`, 452, actionOptions));
  const actionContentH = actionHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, actionHeights.length - 1) * 10;
  const impactText = section.businessProblems.slice(0, 2).map((problem) => problem.expectedImpact).join(" ");
  const impactOptions = { size: 10.2, color: "#475569", lineGap: 6 };
  const impactH = measureTextHeight(doc, impactText, 452, impactOptions);
  const actionsCardH = Math.max(132, Math.ceil(48 + actionContentH + 24));
  const impactCardH = Math.max(132, Math.ceil(48 + impactH + 24));
  y = ensurePageSpace(doc, report, pageState, y, actionsCardH + 16 + impactCardH, () => drawSectionIntro(true));
  doc.roundedRect(48, y, 500, actionsCardH, 18).fillAndStroke("#ffffff", "#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Priority actions", 66, y + 18);
  let actionY = y + 48;
  actions.forEach((item, itemIndex) => {
    actionY = drawParagraph(doc, `${itemIndex + 1}. ${item.action}`, 66, actionY, 452, actionOptions) + 10;
  });
  y += actionsCardH + 16;
  y = ensurePageSpace(doc, report, pageState, y, impactCardH, () => drawSectionIntro(true));
  doc.roundedRect(48, y, 500, impactCardH, 18).fillAndStroke("#ffffff", "#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("Expected business impact", 66, y + 18);
  drawParagraph(doc, impactText, 66, y + 48, 452, impactOptions);
}

function drawFinalActionPage(doc, report, pageState) {
  const drawSectionIntro = (continued = false) => drawSectionTitle(doc, "Recommended Next Steps", continued ? "Final action plan (continued)" : "Final action plan", 80) + 22;
  drawHeaderFooter(doc, report, pageState.pageNumber);
  let y = drawSectionIntro(false);
  report.finalActionPlan.forEach((step) => {
    const titleOptions = { size: 13, bold: true, lineGap: 4 };
    const descriptionOptions = { size: 10.5, color: "#475569", lineGap: 6 };
    const titleH = measureTextHeight(doc, step.title, 410, titleOptions);
    const descriptionH = measureTextHeight(doc, step.description, 410, descriptionOptions);
    const cardH = Math.max(108, Math.ceil(44 + titleH + 14 + descriptionH + 20));
    y = ensurePageSpace(doc, report, pageState, y, cardH, () => drawSectionIntro(true));
    doc.roundedRect(48, y, 500, cardH, 18).fillAndStroke("#ffffff", "#e2e8f0");
    doc.circle(80, y + 30, 14).fill("#dbeafe");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1d4ed8").text(String(step.step), 76, y + 25, { width: 8, align: "center" });
    const titleY = y + 18;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(step.title, 108, titleY, { width: 410, lineGap: 4 });
    const descriptionY = titleY + titleH + 14;
    drawParagraph(doc, step.description, 108, descriptionY, 410, descriptionOptions);
    y += cardH + 16;
  });
  y = ensurePageSpace(doc, report, pageState, y + 12, 128, () => drawSectionIntro(true)) - 12;
  doc.roundedRect(48, y + 12, 500, 116, 18).fill("#0f172a");
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff").text("Suggested next step", 68, y + 32);
  drawParagraph(doc, `${report.cta} ${agency.name} can use the selected services in this report as the priority discussion points, rather than presenting a generic website pitch.`, 68, y + 58, 450, { size: 11, color: "#e2e8f0", lineGap: 6 });
}

async function renderPdf(report, outputPath) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const stream = fsSync.createWriteStream(outputPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    const pageState = { pageNumber: 1 };
    drawCoverPage(doc, report);
    doc.addPage();
    pageState.pageNumber += 1;
    drawExecutiveSummaryPage(doc, report, pageState.pageNumber);
    report.serviceSections.forEach((section, index) => {
      doc.addPage();
      pageState.pageNumber += 1;
      drawServicePage(doc, report, section, index, pageState);
    });
    doc.addPage();
    pageState.pageNumber += 1;
    drawFinalActionPage(doc, report, pageState);
    doc.end();
  });
}

async function reportLead(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      industryRef: true,
      issues: { orderBy: { createdAt: "asc" } },
      screenshots: { orderBy: { createdAt: "desc" } },
      serviceOpportunities: { include: { service: true }, orderBy: [{ recommended: "desc" }, { score: "desc" }] },
      competitors: { orderBy: { createdAt: "desc" } },
      auditReports: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

function normalizeReport(report) {
  if (!report) return null;
  const payload = report.reportData && typeof report.reportData === "object" && !Array.isArray(report.reportData) ? report.reportData : {};
  const selectedServices = Array.isArray(report.selectedServices)
    ? report.selectedServices
    : Array.isArray(payload.selectedServices)
      ? payload.selectedServices
      : selectedServiceObjects(DEFAULT_REPORT_SERVICE_IDS);
  const serviceSections = Array.isArray(payload.serviceSections) ? payload.serviceSections : [];
  return {
    ...report,
    reportData: payload,
    structuredReport: payload,
    selectedServices,
    serviceSections,
    downloadUrl: report.id ? `/api/leads/${report.leadId}/report/download` : null,
    previewUrl: report.id ? `/api/leads/${report.leadId}/report/preview` : null,
    issueCount: serviceSections.reduce((sum, section) => sum + (section.businessProblems?.length || 0), 0),
    recommendationCount: serviceSections.reduce((sum, section) => sum + (section.priorityActions?.length || 0), 0),
    screenshotStatus: report.screenshots?.status || payload.debug?.screenshotStatus || "missing",
    qualityPassed: Boolean(report.qualityGate?.passed),
    canAttach: ["approved", "attached", "sent"].includes(report.status) && Boolean(report.qualityGate?.passed) && Boolean(report.pdfUrl)
  };
}

async function setReportFailed(reportId, message, debugData = {}) {
  return prisma.auditReport.update({
    where: { id: reportId },
    data: {
      status: "failed",
      error: message,
      debugData,
      generatedAt: new Date()
    }
  });
}

export async function generateReport(leadId, userId, options = {}) {
  const lead = await reportLead(leadId);
  if (!clean(lead.website)) throw new HttpError(422, "Lead must have a website before a report can be generated.");
  const selectedServices = selectedServiceObjects(options.selectedServices);
  if (!selectedServices.length) throw new HttpError(422, "Please select at least one service to include in the report.");
  const report = await prisma.auditReport.create({
    data: {
      leadId,
      userId,
      status: "generating",
      reportData: { startedAt: new Date().toISOString(), regenerate: Boolean(options.regenerate) },
      selectedServices,
      debugData: { logs: [{ at: new Date().toISOString(), step: "start", message: "Report generation started." }] }
    }
  });

  try {
    const screenshotData = await ensureReportScreenshots(lead);
    const structured = await buildStructuredReport(lead, screenshotData, selectedServices);
    structured.serviceSections = structured.serviceSections.map((section, sectionIndex) => ({
      ...section,
      businessProblems: (section.businessProblems || []).map((problem, index) =>
        normalizeProblem(problem, index === 0 ? screenshotData.screenshots.homepage || screenshotData.screenshots.mobile : screenshotData.screenshots.mobile || screenshotData.screenshots.homepage)
      ),
      priorityActions: (section.priorityActions || []).map((action) => ({
        ...action,
        action: sentence(action.action),
        reason: sentence(action.reason)
      }))
    }));
    structured.finalActionPlan = (structured.finalActionPlan || []).map((step, index) => ({
      step: Number(step.step || index + 1),
      title: clean(step.title),
      description: sentence(step.description)
    }));
    structured.selectedServices = selectedServices.map((item) => ({ id: item.id, label: item.label, description: item.description }));

    await fs.mkdir(reportsRoot, { recursive: true });
    const fileName = `${safeCompanySlug(lead.company)}-${lead.id}-${Date.now()}.pdf`;
    const absolutePath = path.join(reportsRoot, fileName);
    const pdfUrl = `/uploads/reports/${fileName}`;
    await renderPdf(structured, absolutePath);
    const qualityGate = await runReportQualityGate({ ...structured, pdfUrl });
    const flatProblems = flattenServiceProblems(structured.serviceSections);
    const saved = await prisma.auditReport.update({
      where: { id: report.id },
      data: {
        status: qualityGate.status,
        pdfUrl,
        pdfPath: absolutePath,
        reportData: structured,
        selectedServices: structured.selectedServices,
        screenshots: {
          ...screenshotData,
          paths: flatProblems.map((item) => item.screenshotPath).filter(Boolean)
        },
        issues: flatProblems,
        recommendations: structured.serviceSections.flatMap((section) => section.priorityActions),
        qualityGate,
        debugData: {
          logs: [
            { at: new Date().toISOString(), step: "selected_services", message: `Report focused on: ${selectedServices.map((item) => item.label).join(", ")}` },
            { at: new Date().toISOString(), step: "screenshot", message: screenshotData.logs?.map((item) => item.message).join(" | ") || "Screenshot step complete." },
            { at: new Date().toISOString(), step: "render", message: "PDF rendered successfully." },
            { at: new Date().toISOString(), step: "quality_gate", message: qualityGate.summary }
          ],
          promptInput: structured.debug || {}
        },
        summary: structured.executiveSummary,
        opportunityScore: Number(structured.scores?.opportunityScore || null),
        confidenceScore: Number(structured.scores?.confidenceScore || null),
        error: qualityGate.passed ? null : qualityGate.failedChecks.join(", "),
        generatedAt: new Date()
      },
      include: { lead: { select: { id: true, company: true, website: true } } }
    });
    return normalizeReport(saved);
  } catch (error) {
    await setReportFailed(report.id, error.message || "Report generation failed", { reason: error.message || "Report generation failed." });
    throw error;
  }
}

export async function latestForLead(leadId, userId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw notFound("Lead not found");
  const report = await prisma.auditReport.findFirst({
    where: { leadId, userId },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  return normalizeReport(report);
}

export async function getReport(reportId, userId) {
  const report = await prisma.auditReport.findFirst({
    where: { id: reportId, userId },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  if (!report) throw notFound("Report not found");
  return normalizeReport(report);
}

export async function getReportForLead(leadId, userId) {
  return latestForLead(leadId, userId);
}

export async function approveReport(leadId, userId) {
  const report = await prisma.auditReport.findFirst({
    where: { leadId, userId },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  if (!report) throw notFound("Report not found");
  if (!report.qualityGate?.passed) throw new HttpError(422, "This report has not passed the quality gate yet.");
  const filePath = report.pdfPath || (report.pdfUrl ? absoluteUploadPath(report.pdfUrl) : null);
  if (!filePath) throw new HttpError(422, "Report file is missing.");
  await fs.access(filePath).catch(() => {
    throw new HttpError(422, "Report file is missing.");
  });
  const updated = await prisma.auditReport.update({
    where: { id: report.id },
    data: {
      status: "approved",
      approvedAt: new Date(),
      error: null
    },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  return normalizeReport(updated);
}

export async function regenerateReport(leadId, userId, options = {}) {
  return generateReport(leadId, userId, { ...options, regenerate: true });
}

export async function downloadReportByLead(leadId, userId) {
  const report = await prisma.auditReport.findFirst({
    where: { leadId, userId },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  if (!report) throw notFound("Report not found");
  return downloadReport(report.id, userId);
}

export async function downloadReport(reportId, userId) {
  const report = await prisma.auditReport.findFirst({
    where: { id: reportId, userId },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  if (!report) throw notFound("Report not found");
  const filePath = report.pdfPath || (report.pdfUrl ? absoluteUploadPath(report.pdfUrl) : null);
  if (!filePath) throw notFound("Report file not found");
  await fs.access(filePath).catch(() => {
    throw notFound("Report file not found");
  });
  return { report: normalizeReport(report), filePath };
}

export async function resolveAttachmentForLead(leadId, userId, includeUnapproved = false) {
  const report = await prisma.auditReport.findFirst({
    where: {
      leadId,
      userId,
      ...(includeUnapproved ? {} : { status: { in: ["approved", "attached", "sent"] } })
    },
    orderBy: { createdAt: "desc" },
    include: { lead: { select: { company: true } } }
  });
  if (!report || !report.pdfUrl || !report.qualityGate?.passed) return null;
  const filePath = report.pdfPath || absoluteUploadPath(report.pdfUrl);
  await fs.access(filePath).catch(() => {
    throw new HttpError(422, "Approved report file is missing.");
  });
  return {
    reportId: report.id,
    filePath,
    filename: `${safeCompanySlug(report.lead?.company || "website-report")}-website-opportunity-report.pdf`,
    mimeType: "application/pdf",
    status: report.status,
    selectedServices: Array.isArray(report.selectedServices)
      ? report.selectedServices
      : Array.isArray(report.reportData?.selectedServices)
        ? report.reportData.selectedServices
        : []
  };
}

export async function markReportAttached(reportId) {
  if (!reportId) return;
  await prisma.auditReport.update({
    where: { id: reportId },
    data: { status: "attached", attachedAt: new Date() }
  }).catch(() => {});
}

export async function markReportSent(reportId) {
  if (!reportId) return;
  await prisma.auditReport.update({
    where: { id: reportId },
    data: { status: "sent", sentAt: new Date() }
  }).catch(() => {});
}

export { REPORT_SERVICE_OPTIONS, DEFAULT_REPORT_SERVICE_IDS };
