import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");
const uploadsRoot = path.resolve(backendRoot, "uploads");
const reportsRoot = path.resolve(uploadsRoot, "reports");

const PAGE = { width: 595, height: 842, margin: 54 };
const colors = {
  ink: "#16120e",
  muted: "#71685b",
  cream: "#f5efe4",
  paper: "#fffaf1",
  gold: "#b89252",
  goldSoft: "#dec997",
  line: "#dfd1bb",
  dark: "#11100d",
  darkSoft: "#211c16",
  white: "#fbf6ec"
};

const industryConfigs = {
  beauty: {
    label: "Beauty & Aesthetics",
    objective: "Increase consultation bookings from visitors comparing treatments.",
    benchmark: [
      "show before and after results close to treatment pages",
      "make consultation booking visible on mobile",
      "display practitioner credentials before enquiry",
      "place reviews beside high-intent treatment content"
    ],
    strengths: ["professional visual presentation", "clear treatment/service positioning", "accessible contact path", "visible social proof"],
    opportunityAngles: ["consultation booking clarity", "before and after proof", "practitioner trust", "mobile WhatsApp or booking flow", "treatment page depth"]
  },
  medical: {
    label: "Dental / Medical",
    objective: "Turn patient research into appointment enquiries.",
    benchmark: [
      "show doctor profiles and credentials prominently",
      "make appointment booking obvious from the first screen",
      "place reviews and reassurance near contact points",
      "clarify location, emergency contact, and insurance information"
    ],
    strengths: ["professional trust presentation", "clear contact information", "visible service information", "reassuring brand tone"],
    opportunityAngles: ["appointment flow", "doctor credibility", "patient trust proof", "location visibility", "emergency contact clarity"]
  },
  interior: {
    label: "Interior Design / Renovation",
    objective: "Convert visual interest into qualified project enquiries.",
    benchmark: [
      "show completed project galleries prominently",
      "display certifications above the fold",
      "explain the renovation or design process clearly",
      "place testimonials near project enquiry forms"
    ],
    strengths: ["visual credibility", "portfolio potential", "premium positioning", "clear project/service direction"],
    opportunityAngles: ["portfolio depth", "project enquiry flow", "renovation credibility", "case study visibility", "process explanation"]
  },
  restaurants: {
    label: "Restaurants",
    objective: "Make it easy for diners to view, trust, and reserve.",
    benchmark: [
      "make the menu accessible within one tap",
      "place reservations and directions near the top of mobile pages",
      "surface reviews before visitors leave for maps",
      "keep ordering or booking paths simple"
    ],
    strengths: ["local discovery potential", "menu or offer clarity", "review potential", "mobile-first demand"],
    opportunityAngles: ["reservation clarity", "menu accessibility", "maps visibility", "review placement", "mobile ordering flow"]
  },
  homeServices: {
    label: "Home Services",
    objective: "Turn urgent service searches into quote requests.",
    benchmark: [
      "make quote requests visible immediately",
      "show emergency contact details on mobile",
      "place reviews and trust badges beside service pages",
      "build location-specific service pages"
    ],
    strengths: ["clear service demand", "phone-led enquiry potential", "local search opportunity", "review-driven trust"],
    opportunityAngles: ["quote request flow", "emergency contact visibility", "service page depth", "local SEO", "trust badge placement"]
  },
  consultants: {
    label: "Consultants",
    objective: "Turn authority and expertise into qualified consultation enquiries.",
    benchmark: [
      "lead with a clear point of view",
      "show case studies and outcomes before the enquiry form",
      "qualify leads with a clear consultation path",
      "publish thought leadership that proves expertise"
    ],
    strengths: ["authority positioning", "expertise proof", "consultation potential", "clear niche direction"],
    opportunityAngles: ["authority positioning", "case study visibility", "thought leadership", "lead qualification", "consultation booking clarity"]
  },
  general: {
    label: "Professional Services",
    objective: "Convert website visitors into clearer, higher-intent enquiries.",
    benchmark: [
      "make the enquiry path obvious from the first screen",
      "show proof near the moments where visitors decide",
      "explain services in business language",
      "measure which channels create enquiries"
    ],
    strengths: ["clear service positioning", "professional presentation", "contact accessibility", "trust-building potential"],
    opportunityAngles: ["enquiry clarity", "trust proof", "service page depth", "visibility", "conversion measurement"]
  }
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function pathFromUploadUrl(value) {
  const clean = String(value || "").split("?")[0];
  if (!clean || /^https?:\/\//i.test(clean)) return null;
  if (clean.startsWith("/uploads/")) return path.join(uploadsRoot, clean.replace(/^\/uploads\//, ""));
  if (path.isAbsolute(clean)) return clean;
  return path.resolve(backendRoot, clean);
}

async function existingImagePath(value) {
  const filePath = pathFromUploadUrl(value);
  if (!filePath) return "";
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return "";
  }
}

function industryText(lead) {
  return `${lead.industryRef?.slug || ""} ${lead.industryRef?.name || ""} ${lead.industry || ""} ${lead.company || ""}`.toLowerCase();
}

export function getIndustryReportConfig(leadOrIndustry) {
  const value = typeof leadOrIndustry === "string" ? leadOrIndustry.toLowerCase() : industryText(leadOrIndustry || {});
  if (/beauty|aesthetic|salon|spa|skin|lash|nail|wellness|treatment/.test(value)) return industryConfigs.beauty;
  if (/dental|dentist|medical|clinic|doctor|patient|health|orthodont|physio/.test(value)) return industryConfigs.medical;
  if (/interior|renovation|design studio|home design|decor|hdb|contractor/.test(value)) return industryConfigs.interior;
  if (/restaurant|cafe|bar|bistro|food|dining|menu|reservation/.test(value)) return industryConfigs.restaurants;
  if (/home service|plumb|electric|roof|repair|hvac|clean|moving|quote|pest/.test(value)) return industryConfigs.homeServices;
  if (/consult|advisor|coach|agency|professional|legal|accounting|finance/.test(value)) return industryConfigs.consultants;
  return industryConfigs.general;
}

function visibleContactSignals(lead) {
  return [
    lead.phone ? "phone number" : null,
    lead.generalEmail || lead.ownerEmail ? "email" : null,
    lead.whatsapp ? "WhatsApp" : null,
    lead.linkedinCompany ? "LinkedIn" : null,
    lead.instagram ? "Instagram" : null,
    lead.facebook ? "Facebook" : null
  ].filter(Boolean);
}

function detectedTechSignals(lead) {
  return [
    lead.cms ? `${lead.cms} platform` : null,
    lead.analyticsGa4 || lead.analyticsGtm ? "analytics tracking" : null,
    lead.analyticsMetaPixel ? "Meta Pixel" : null,
    lead.bookingCalendly || lead.bookingSimplyBook || lead.bookingAcuity ? "booking tool" : null,
    lead.chatIntercom || lead.chatTawk || lead.chatZendesk ? "live chat" : null
  ].filter(Boolean);
}

function rawIssues(lead) {
  return asArray(lead.issues).map((issue) => cleanText(issue.issueText || issue)).filter(Boolean);
}

function rawFixes(lead) {
  return asArray(lead.recommendedFixes)
    .map((fix) => cleanText(typeof fix === "string" ? fix : fix.title || fix.details || fix.description))
    .filter(Boolean);
}

function visualObservation(lead, config, hasDesktop, hasMobile) {
  if (/FORBIDDEN|CLOUDFLARE|BOT_PROTECTION|CAPTCHA/.test(lead.websiteStatus || "") || /blocked|forbidden|cloudflare|captcha/i.test(`${lead.accessIssue || ""} ${lead.accessIssueReason || ""} ${rawIssues(lead).join(" ")}`)) {
    return {
      title: "Legitimate visitors can hit an access barrier before seeing the brand",
      observation: `The captured visual review for ${lead.company} shows an access or security screen appearing before the core website experience.`,
      evidence: "The screenshot capture shows a blocked-access experience rather than the intended homepage content.",
      whyItMatters: "A visitor who cannot immediately see services, proof, or contact options has no reason to continue the journey.",
      businessImpact: "Qualified visitors can be lost before they reach enquiry, booking, or contact points.",
      recommendation: "Review security rules, bot protection, and hosting access settings so genuine visitors and business prospects can reach the site reliably.",
      expectedOutcome: "More legitimate visitors reach the content that can persuade them to enquire.",
      priority: "High",
      screenshotBased: true,
      companySpecific: true,
      industrySpecific: false
    };
  }
  if (hasMobile) {
    return {
      title: "The mobile first screen needs to make the next step unmistakable",
      observation: `The mobile screenshot for ${lead.company} should lead visitors toward ${config.objective.toLowerCase()}, not make them search for the next action.`,
      evidence: "The mobile capture gives a direct view of the above-the-fold decision moment where visitors decide whether to continue or contact the business.",
      whyItMatters: "Mobile visitors are often comparing options quickly and rarely work hard to find the next step.",
      businessImpact: "A hidden or visually weak enquiry path reduces the number of visitors who become bookings, consultations, or quote requests.",
      recommendation: "Make the primary enquiry action visible earlier and repeat it consistently through the mobile journey.",
      expectedOutcome: "More high-intent mobile visitors understand exactly how to act.",
      priority: "High",
      screenshotBased: true,
      companySpecific: true,
      industrySpecific: true
    };
  }
  if (hasDesktop) {
    return {
      title: "The first screen should carry more commercial weight",
      observation: `The homepage screenshot for ${lead.company} is the first proof point a visitor sees, so it needs to communicate credibility and the next step immediately.`,
      evidence: "The desktop capture provides a visual review of the first impression and above-the-fold content hierarchy.",
      whyItMatters: "The first screen sets the level of trust before visitors read deeper pages.",
      businessImpact: "If the value proposition or enquiry action is not obvious, visitors continue comparing alternatives.",
      recommendation: "Strengthen the first screen with clearer proof, sharper positioning, and a more visually prominent enquiry path.",
      expectedOutcome: "Visitors understand the business faster and have a clearer reason to make contact.",
      priority: "High",
      screenshotBased: true,
      companySpecific: true,
      industrySpecific: false
    };
  }
  return {
    title: "The first impression needs to be reviewed visually",
    observation: `${lead.company} should add a current homepage screenshot to confirm whether the first screen supports trust and enquiry clarity.`,
    evidence: "A visual screenshot was not available in the current report data, so this is flagged as a required review item before final outreach.",
    whyItMatters: "A report without visual evidence cannot confidently judge the visitor journey.",
    businessImpact: "Important conversion issues can remain hidden if the first screen is not reviewed.",
    recommendation: "Run a fresh website scan with desktop and mobile screenshots before sending the report externally.",
    expectedOutcome: "The next report version can point to specific visual friction instead of relying on scan signals.",
    priority: "High",
    screenshotBased: true,
    companySpecific: true,
    industrySpecific: false
  };
}

function industryObservation(lead, config) {
  const angle = config.opportunityAngles[0];
  return {
    title: `${config.label} visitors need stronger ${angle}`,
    observation: `${lead.company} operates in a category where visitors expect ${config.benchmark.slice(0, 2).join(" and ")} before they commit to an enquiry.`,
    evidence: `The audit data was evaluated against the ${config.label} decision journey, where ${config.objective.toLowerCase()}`,
    whyItMatters: "Industry-specific buying behaviour affects what visitors need to see before they trust the business.",
    businessImpact: "When the expected proof is not prominent, visitors are more likely to compare competitors instead of enquiring.",
    recommendation: `Prioritise ${angle} and connect it directly to the main enquiry path.`,
    expectedOutcome: "The website feels more aligned with what customers in this category need before taking action.",
    priority: "High",
    screenshotBased: false,
    companySpecific: true,
    industrySpecific: true
  };
}

function contactObservation(lead) {
  const signals = visibleContactSignals(lead);
  if (signals.length) {
    return {
      title: "Contact access exists but should be turned into a clearer enquiry path",
      observation: `${lead.company} has visible contact signals (${signals.join(", ")}), but contact availability should be positioned as a deliberate conversion path rather than passive information.`,
      evidence: `The scan found ${signals.join(", ")} as available contact routes.`,
      whyItMatters: "Visitors who are ready to enquire need a confident next step, not just contact details buried in the page.",
      businessImpact: "Passive contact placement can reduce enquiries from visitors who are already interested.",
      recommendation: "Convert contact details into a repeated, visually consistent enquiry route across key pages.",
      expectedOutcome: "More visitors move from interest to direct contact.",
      priority: "Medium",
      screenshotBased: false,
      companySpecific: true,
      industrySpecific: false
    };
  }
  return {
    title: "The enquiry route needs to be easier to find",
    observation: `${lead.company} does not have enough clearly detected contact signals in the current scan data.`,
    evidence: "The scan did not clearly identify email, WhatsApp, or social contact routes.",
    whyItMatters: "A visitor with intent should not have to search for the way to contact the business.",
    businessImpact: "Hard-to-find contact options reduce enquiries, especially on mobile.",
    recommendation: "Place the primary contact action in the header, first screen, and key service sections.",
    expectedOutcome: "Visitors can take action faster and with less friction.",
    priority: "High",
    screenshotBased: false,
    companySpecific: true,
    industrySpecific: false
  };
}

function measurementObservation(lead) {
  if (lead.analyticsGa4 || lead.analyticsGtm) {
    return {
      title: "Enquiry performance should be measured beyond page visits",
      observation: `${lead.company} appears to have analytics foundations, but the business should measure form submits, calls, booking clicks, and WhatsApp taps as commercial outcomes.`,
      evidence: "Analytics tooling was detected, but the report data does not confirm conversion-event coverage.",
      whyItMatters: "Traffic alone does not show which channels create real enquiries.",
      businessImpact: "Marketing spend is harder to improve when enquiry sources are not measured clearly.",
      recommendation: "Track every high-intent action and review enquiry source quality monthly.",
      expectedOutcome: "The business can invest more confidently in channels that create bookings or enquiries.",
      priority: "Medium",
      screenshotBased: false,
      companySpecific: true,
      industrySpecific: false
    };
  }
  return {
    title: "Marketing performance is difficult to judge without enquiry tracking",
    observation: `${lead.company} does not show clear analytics tracking in the current scan, which makes it harder to understand which channels create enquiries.`,
    evidence: "GA4 or Google Tag Manager was not clearly detected.",
    whyItMatters: "A business cannot reliably improve what it cannot measure.",
    businessImpact: "Budget can be spent on traffic without knowing which visits turn into bookings, calls, or quote requests.",
    recommendation: "Install analytics and track form submissions, phone clicks, booking actions, and WhatsApp taps.",
    expectedOutcome: "Marketing decisions become tied to actual enquiries rather than surface-level traffic.",
    priority: "Medium",
    screenshotBased: false,
    companySpecific: true,
    industrySpecific: false
  };
}

function issueObservation(lead, issue, index) {
  const text = cleanText(issue);
  const title = /security|forbidden|blocked|cloudflare|captcha/i.test(text)
    ? "Access friction is creating a trust problem before the sales journey begins"
    : /mobile/i.test(text)
      ? "Mobile visitors need a shorter route from interest to enquiry"
      : /review|trust|proof|credential|testimonial/i.test(text)
        ? "Trust proof needs to appear closer to the enquiry decision"
        : /seo|search|local|maps/i.test(text)
          ? "Search visibility should connect to higher-intent enquiries"
          : "The visitor journey needs a clearer commercial next step";
  return {
    title,
    observation: `${lead.company} has a scan finding that points to a growth leak: ${sentence(text)}`,
    evidence: text,
    whyItMatters: index === 0 ? "The first major friction point often has the largest effect on enquiry quality." : "Small points of friction compound when visitors are comparing alternatives.",
    businessImpact: /seo|search|local|maps/i.test(text)
      ? "Competitors are more likely to capture visitors searching for this service."
      : "Interested visitors can leave before they feel confident enough to contact the business.",
    recommendation: /security|forbidden|blocked|cloudflare|captcha/i.test(text)
      ? "Resolve the access issue first, then review the page experience that follows."
      : "Turn this finding into a visible change on the highest-intent pages rather than treating it as a technical checklist item.",
    expectedOutcome: "Visitors encounter less friction and receive clearer reasons to enquire.",
    priority: index === 0 ? "High" : "Medium",
    screenshotBased: false,
    companySpecific: true,
    industrySpecific: false
  };
}

function uniqueByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateObservationSet(lead, scanData) {
  const { config, hasDesktop, hasMobile } = scanData;
  const observations = [
    visualObservation(lead, config, hasDesktop, hasMobile),
    industryObservation(lead, config),
    contactObservation(lead),
    measurementObservation(lead),
    ...rawIssues(lead).slice(0, 3).map((issue, index) => issueObservation(lead, issue, index)),
    ...rawFixes(lead).slice(0, 2).map((fix, index) => issueObservation(lead, fix, index + 1))
  ];
  return uniqueByTitle(observations).slice(0, 7);
}

function validateObservationSet(observations) {
  const companySpecific = observations.filter((item) => item.companySpecific).length;
  const screenshotBased = observations.some((item) => item.screenshotBased);
  const industrySpecific = observations.some((item) => item.industrySpecific);
  if (companySpecific < 3 || !screenshotBased || !industrySpecific) {
    throw new HttpError(422, "Report observations were not specific enough to generate a client-facing audit. Run a fresh scan with screenshots and audit data.");
  }
}

export function formatEvidenceForClient(scanData) {
  return generateObservationSet(scanData.lead, scanData).map((item) => item.evidence).filter(Boolean).slice(0, 6);
}

export function generateBusinessOpportunities(_lead, scanData) {
  const observations = scanData.observations || generateObservationSet(scanData.lead, scanData);
  return observations.slice(0, 3);
}

function inferStrengths(lead, config) {
  const strengths = [];
  const contacts = visibleContactSignals(lead);
  const tech = detectedTechSignals(lead);
  if (contacts.length) strengths.push(`${lead.company} already gives visitors at least one way to make contact, which is a useful base for improving enquiries.`);
  if (tech.length) strengths.push(`The website has existing infrastructure (${tech.slice(0, 2).join(", ")}) that can support a more measurable growth journey.`);
  strengths.push(`${config.strengths[0]} gives the business a foundation to build stronger trust.`);
  strengths.push(`${config.strengths[1]} can be sharpened into clearer decision-making content.`);
  return strengths.filter(Boolean).slice(0, 5);
}

export function generateExecutiveSummary(lead, scanData) {
  const { config, observations } = scanData;
  const primary = observations[0];
  const risk = observations.find((item) => item.priority === "High") || primary;
  return {
    narrative: `After reviewing ${lead.company}'s website, enquiry journey, visible trust signals, and industry expectations, we identified three practical opportunities likely limiting enquiry growth.`,
    currentStrength: inferStrengths(lead, config)[0],
    primaryOpportunity: primary.title,
    biggestRisk: risk.businessImpact,
    recommendedFocus: `${primary.recommendation} This should happen first because it directly supports the commercial objective: ${config.objective.toLowerCase()}`,
    keyOpportunities: observations.slice(0, 3).map((item) => item.title)
  };
}

export function generateActionRoadmap(opportunities) {
  const topic = (item) => cleanText(item?.title || "the enquiry journey").toLowerCase();
  return {
    immediate: [
      `Address ${topic(opportunities[0])} so visitors have fewer reasons to leave before enquiring.`,
      "Move the strongest proof closer to the primary enquiry or booking action.",
      "Check the first mobile screen for a clear next step."
    ],
    sixtyDay: [
      `Build a focused page or section around ${topic(opportunities[1])} to improve trust and conversion.`,
      "Set up enquiry tracking for calls, forms, booking clicks, and WhatsApp taps.",
      "Refresh the highest-intent service content so it speaks to buyer decisions, not internal services."
    ],
    ninetyDay: [
      `Turn ${topic(opportunities[2])} into a repeatable conversion system across key pages.`,
      "Add deeper proof such as reviews, case studies, galleries, credentials, or project examples.",
      "Review local visibility and create content for the highest-value search moments."
    ]
  };
}

function competitorPosition(data) {
  if (!data.competitors.length) {
    return {
      mode: "benchmark",
      headline: "Industry benchmark comparison",
      summary: `Top-performing ${data.industry.toLowerCase()} websites typically reduce doubt before visitors reach the enquiry point.`,
      strongerElsewhere: data.config.benchmark,
      strongerHere: data.strengths.slice(0, 2),
      largestGap: data.opportunities[0]?.title || "Making the enquiry path more persuasive"
    };
  }
  const competitorStrengths = data.competitors.flatMap((item) => item.strengths).filter(Boolean).slice(0, 4);
  return {
    mode: "competitors",
    headline: "Competitive position",
    summary: `${data.company} can compete more effectively by closing the gap between visible trust, enquiry clarity, and the proof competitors show before visitors make contact.`,
    strongerElsewhere: competitorStrengths.length ? competitorStrengths : ["Competitors appear to show stronger proof near decision points."],
    strongerHere: data.strengths.slice(0, 2),
    largestGap: data.opportunities[0]?.title || "Enquiry journey clarity"
  };
}

function reportPayload(lead, desktopPath, mobilePath) {
  const config = getIndustryReportConfig(lead);
  const scanData = { lead, config, hasDesktop: Boolean(desktopPath), hasMobile: Boolean(mobilePath) };
  const observations = generateObservationSet(lead, scanData);
  validateObservationSet(observations);
  const enrichedScanData = { ...scanData, observations };
  const opportunities = generateBusinessOpportunities(lead, enrichedScanData);
  const strengths = inferStrengths(lead, config);
  const data = {
    company: lead.company,
    website: lead.website,
    industry: config.label,
    generatedAt: new Date().toISOString(),
    config,
    observations,
    opportunities,
    strengths,
    summary: generateExecutiveSummary(lead, enrichedScanData),
    roadmap: generateActionRoadmap(opportunities),
    serviceAreas: [...new Set([firstRecommendedService(lead)?.service?.name, ...config.opportunityAngles].filter(Boolean))].slice(0, 5),
    images: { desktopPath, mobilePath },
    competitors: lead.competitors.map((item) => ({
      company: item.company,
      website: item.website,
      strengths: asArray(item.strengths).map(cleanText).filter(Boolean),
      weaknesses: asArray(item.weaknesses).map(cleanText).filter(Boolean)
    }))
  };
  return { ...data, competitorPosition: competitorPosition(data) };
}

function firstRecommendedService(lead) {
  return lead.serviceOpportunities?.find((item) => item.recommended) || lead.serviceOpportunities?.[0] || null;
}

function drawBackground(doc, dark = false) {
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(dark ? colors.dark : colors.cream);
  if (dark) {
    doc.circle(515, 82, 155).fillOpacity(0.14).fill(colors.gold).fillOpacity(1);
    doc.rect(0, 704, PAGE.width, 138).fill(colors.darkSoft);
  }
}

function drawBrand(doc, section, page, dark = false) {
  const text = dark ? colors.goldSoft : colors.gold;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(text).text("OCIA STUDIO", PAGE.margin, 42, { characterSpacing: 2 });
  doc.font("Helvetica-Bold").fontSize(8).fillColor(text).text(section.toUpperCase(), 336, 42, { width: 205, align: "right", characterSpacing: 1.2 });
  doc.moveTo(PAGE.margin, 66).lineTo(PAGE.width - PAGE.margin, 66).strokeColor(dark ? "#665234" : colors.line).lineWidth(0.8).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(dark ? "#9f8e72" : colors.muted).text(`Page ${page}`, 500, 806, { width: 42, align: "right" });
}

function label(doc, text, x, y, options = {}) {
  doc.font("Helvetica-Bold").fontSize(options.size || 8).fillColor(options.color || colors.gold).text(String(text).toUpperCase(), x, y, {
    width: options.width || 250,
    characterSpacing: 1.4
  });
  return doc.y;
}

function heading(doc, text, x, y, options = {}) {
  doc.font("Times-Bold").fontSize(options.size || 34).fillColor(options.color || colors.ink).text(text, x, y, {
    width: options.width || 450,
    lineGap: options.lineGap ?? -1
  });
  return doc.y;
}

function body(doc, text, x, y, options = {}) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size || 10.5).fillColor(options.color || colors.muted).text(text, x, y, {
    width: options.width || 430,
    lineGap: options.lineGap ?? 4
  });
  return doc.y;
}

function bulletList(doc, items, x, y, width, options = {}) {
  let cursor = y;
  items.filter(Boolean).slice(0, options.limit || 6).forEach((item) => {
    doc.circle(x + 4, cursor + 7, 2).fill(options.bulletColor || colors.gold);
    doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size || 10.3).fillColor(options.color || colors.ink).text(item, x + 16, cursor, { width, lineGap: 3 });
    cursor = doc.y + (options.gap ?? 10);
  });
  return cursor;
}

function drawRule(doc, x, y, width = 489) {
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor(colors.line).lineWidth(0.7).stroke();
}

function drawImageBox(doc, imagePath, x, y, width, height, caption, dark = false) {
  doc.roundedRect(x, y, width, height, 18).fillAndStroke(dark ? "#18130f" : colors.paper, dark ? "#745c36" : colors.line);
  if (imagePath) {
    try {
      doc.save();
      doc.roundedRect(x + 2, y + 2, width - 4, height - 4, 16).clip();
      doc.image(imagePath, x + 2, y + 2, { fit: [width - 4, height - 4], align: "center", valign: "center" });
      doc.restore();
      return;
    } catch {
      doc.restore?.();
    }
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor(dark ? colors.goldSoft : colors.gold).text(caption, x + 20, y + height / 2 - 8, { width: width - 40, align: "center" });
}

function drawPanel(doc, x, y, width, height, title, text, options = {}) {
  doc.roundedRect(x, y, width, height, 18).fillAndStroke(options.fill || colors.paper, options.stroke || colors.line);
  label(doc, title, x + 18, y + 18, { width: width - 36, color: options.labelColor || colors.gold });
  body(doc, text, x + 18, y + 42, { width: width - 36, size: options.size || 10.5, color: options.color || colors.ink });
}

function drawCover(doc, data) {
  drawBackground(doc, true);
  drawBrand(doc, "Growth Opportunity Assessment", 1, true);
  label(doc, "Growth Opportunity Assessment", PAGE.margin, 104, { color: colors.goldSoft, width: 330 });
  doc.font("Times-Bold").fontSize(49).fillColor(colors.white).text(data.company, PAGE.margin, 132, { width: 430, lineGap: -5 });
  const metaY = Math.max(doc.y + 16, 244);
  body(doc, `${data.industry}\n${data.website}\nPrepared by Ocia Studio\n${new Date(data.generatedAt).toLocaleDateString()}`, PAGE.margin, metaY, { width: 320, color: "#d8ccb9", size: 11, lineGap: 7 });
  drawImageBox(doc, data.images.desktopPath, PAGE.margin, 354, 489, 310, "Website screenshot unavailable", true);
  doc.font("Times-Bold").fontSize(22).fillColor(colors.white).text("A strategy report on where growth is leaking across trust, visibility, and enquiry conversion.", PAGE.margin, 716, { width: 445, lineGap: 2 });
}

function drawExecutiveSummary(doc, data) {
  drawBackground(doc);
  drawBrand(doc, "Executive Summary", 2);
  label(doc, "Business impact first", PAGE.margin, 96);
  heading(doc, "Executive summary", PAGE.margin, 118, { size: 38 });
  body(doc, data.summary.narrative, PAGE.margin, 172, { width: 468, size: 12.5, color: colors.ink, lineGap: 5 });
  drawPanel(doc, PAGE.margin, 260, 489, 84, "Current strengths", data.summary.currentStrength, { fill: "#fbf3e4" });
  drawPanel(doc, PAGE.margin, 364, 489, 90, "Primary opportunity", data.summary.primaryOpportunity);
  drawPanel(doc, PAGE.margin, 474, 489, 96, "Biggest business risk", data.summary.biggestRisk);
  doc.roundedRect(PAGE.margin, 598, 489, 118, 18).fill(colors.dark);
  label(doc, "Recommended focus", PAGE.margin + 20, 620, { color: colors.goldSoft });
  body(doc, data.summary.recommendedFocus, PAGE.margin + 20, 644, { width: 430, color: colors.white, size: 10.8 });
}

function drawWorking(doc, data) {
  drawBackground(doc);
  drawBrand(doc, "What Is Already Working", 3);
  label(doc, "Positive foundation", PAGE.margin, 96);
  heading(doc, "What is already working", PAGE.margin, 118, { size: 38 });
  body(doc, "The report starts with strengths because a good growth strategy builds on what already earns trust.", PAGE.margin, 170, { width: 450, size: 12, color: colors.ink });
  bulletList(doc, data.strengths, PAGE.margin, 235, 460, { size: 12, gap: 17 });
  drawRule(doc, PAGE.margin, 448);
  label(doc, "Specific observations used in this review", PAGE.margin, 482, { width: 360 });
  bulletList(doc, data.observations.slice(0, 4).map((item) => item.observation), PAGE.margin, 516, 430, { size: 10.5, color: colors.muted, gap: 11 });
}

function drawOpportunity(doc, opportunity, index) {
  const page = index + 4;
  const titleSize = opportunity.title.length > 70 ? 28 : opportunity.title.length > 48 ? 31 : 34;
  const ruleY = opportunity.title.length > 70 ? 228 : opportunity.title.length > 48 ? 212 : 195;
  const panelY = ruleY + 24;
  drawBackground(doc);
  drawBrand(doc, "Priority Opportunity", page);
  label(doc, `Priority ${index + 1} - ${opportunity.priority}`, PAGE.margin, 96);
  heading(doc, opportunity.title, PAGE.margin, 118, { size: titleSize, width: 470 });
  drawRule(doc, PAGE.margin, ruleY);
  drawPanel(doc, PAGE.margin, panelY, 489, 82, "Observation", opportunity.observation);
  drawPanel(doc, PAGE.margin, panelY + 102, 235, 112, "Evidence", opportunity.evidence);
  drawPanel(doc, 307, panelY + 102, 235, 112, "Why it matters", opportunity.whyItMatters);
  drawPanel(doc, PAGE.margin, panelY + 234, 235, 126, "Business impact", opportunity.businessImpact);
  drawPanel(doc, 307, panelY + 234, 235, 126, "Recommendation", opportunity.recommendation);
  doc.roundedRect(PAGE.margin, panelY + 392, 489, 90, 18).fill(colors.dark);
  label(doc, "Expected outcome", PAGE.margin + 20, panelY + 414, { color: colors.goldSoft });
  body(doc, opportunity.expectedOutcome, PAGE.margin + 20, panelY + 438, { width: 435, color: colors.white, size: 11.5 });
  if (opportunity.screenshotBased && index === 0 && doc._font) {
    label(doc, "Based on visual review", PAGE.margin, 760);
  }
}

function drawCompetitivePosition(doc, data) {
  const pos = data.competitorPosition;
  drawBackground(doc);
  drawBrand(doc, "Competitive Position", 7);
  label(doc, pos.mode === "benchmark" ? "Industry benchmark" : "Market comparison", PAGE.margin, 96);
  heading(doc, pos.headline, PAGE.margin, 118, { size: 38 });
  body(doc, pos.summary, PAGE.margin, 176, { width: 460, size: 12.5, color: colors.ink, lineGap: 5 });
  drawPanel(doc, PAGE.margin, 270, 489, 108, "Largest competitive gap", pos.largestGap, { fill: "#fbf3e4", size: 13 });
  label(doc, pos.mode === "benchmark" ? "Top performers typically" : "Where competitors are stronger", PAGE.margin, 430, { width: 300 });
  bulletList(doc, pos.strongerElsewhere, PAGE.margin, 462, 430, { size: 11.5, gap: 13 });
  label(doc, `Where ${data.company} has a base to build from`, PAGE.margin, 620, { width: 420 });
  bulletList(doc, pos.strongerHere, PAGE.margin, 652, 430, { size: 11, gap: 12, color: colors.muted });
}

function drawRoadmap(doc, data) {
  drawBackground(doc);
  drawBrand(doc, "30 / 60 / 90 Day Roadmap", 8);
  label(doc, "From insight to action", PAGE.margin, 96);
  heading(doc, "30 / 60 / 90 day roadmap", PAGE.margin, 118, { size: 36 });
  body(doc, "Each action connects to one of four commercial outcomes: more enquiries, more bookings, stronger trust, or better visibility.", PAGE.margin, 170, { width: 460, size: 12, color: colors.ink });
  const rows = [
    ["Immediate priorities", data.roadmap.immediate],
    ["60-day priorities", data.roadmap.sixtyDay],
    ["90-day opportunities", data.roadmap.ninetyDay]
  ];
  let y = 244;
  rows.forEach(([title, items]) => {
    doc.roundedRect(PAGE.margin, y, 489, 138, 18).fillAndStroke(colors.paper, colors.line);
    label(doc, title, PAGE.margin + 20, y + 20);
    bulletList(doc, items, PAGE.margin + 20, y + 50, 430, { size: 10.4, gap: 9 });
    y += 156;
  });
}

function drawRecommendation(doc, data) {
  const first = data.opportunities[0];
  drawBackground(doc, true);
  drawBrand(doc, "Ocia Recommendation", 9, true);
  label(doc, "Strategic recommendation", PAGE.margin, 105, { color: colors.goldSoft });
  heading(doc, "What should happen first", PAGE.margin, 132, { size: 42, width: 430, color: colors.white });
  body(doc, sentence(first.recommendation), PAGE.margin, 218, { width: 430, size: 13, color: "#d8ccb9", lineGap: 6 });
  drawPanel(doc, PAGE.margin, 326, 489, 98, "Why this first", first.whyItMatters, { fill: "#1a1611", stroke: "#6a5536", labelColor: colors.goldSoft, color: colors.white, size: 11.5 });
  drawPanel(doc, PAGE.margin, 450, 489, 98, "Expected impact", first.expectedOutcome, { fill: "#1a1611", stroke: "#6a5536", labelColor: colors.goldSoft, color: colors.white, size: 11.5 });
  doc.roundedRect(PAGE.margin, 620, 489, 86, 20).fill(colors.gold);
  doc.font("Times-Bold").fontSize(22).fillColor(colors.dark).text("Book a complimentary strategy session with Ocia Studio.", PAGE.margin + 24, 646, { width: 430, align: "center" });
}

async function renderPdf(data, { outputPath }) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${data.company} Growth Opportunity Assessment`, Author: "Ocia Studio" }, compress: false });
    const stream = fsSync.createWriteStream(outputPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    drawCover(doc, data);
    doc.addPage();
    drawExecutiveSummary(doc, data);
    doc.addPage();
    drawWorking(doc, data);
    data.opportunities.slice(0, 3).forEach((opportunity, index) => {
      doc.addPage();
      drawOpportunity(doc, opportunity, index);
    });
    doc.addPage();
    drawCompetitivePosition(doc, data);
    doc.addPage();
    drawRoadmap(doc, data);
    doc.addPage();
    drawRecommendation(doc, data);
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
      competitors: { orderBy: { createdAt: "desc" } }
    }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

export async function generateReport(leadId, userId) {
  const lead = await reportLead(leadId);
  const desktopPath = lead.screenshotPath || lead.screenshots.find((item) => item.type === "DESKTOP")?.imagePath;
  const mobilePath = lead.mobileScreenshotPath || lead.screenshots.find((item) => item.type === "MOBILE")?.imagePath;
  const data = reportPayload(lead, await existingImagePath(desktopPath), await existingImagePath(mobilePath));
  await fs.mkdir(reportsRoot, { recursive: true });
  const fileName = `${lead.id}-${Date.now()}.pdf`;
  const absPath = path.join(reportsRoot, fileName);
  await renderPdf(data, { outputPath: absPath });
  return prisma.auditReport.create({
    data: {
      leadId,
      userId,
      pdfUrl: `/uploads/reports/${fileName}`,
      reportData: {
        ...data,
        images: { desktopImage: Boolean(data.images.desktopPath), mobileImage: Boolean(data.images.mobilePath) }
      }
    }
  });
}

export async function latestForLead(leadId, userId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw notFound("Lead not found");
  return prisma.auditReport.findFirst({
    where: { leadId, userId },
    orderBy: { createdAt: "desc" }
  });
}

export async function getReport(id, userId) {
  const report = await prisma.auditReport.findFirst({
    where: { id, userId },
    include: { lead: { select: { id: true, company: true, website: true } } }
  });
  if (!report) throw notFound("Audit report not found");
  return report;
}

export async function downloadReport(id, userId) {
  const report = await getReport(id, userId);
  const filePath = pathFromUploadUrl(report.pdfUrl);
  if (!filePath) throw notFound("Audit report file not found");
  await fs.access(filePath).catch(() => {
    throw notFound("Audit report file not found");
  });
  return { report, filePath };
}
