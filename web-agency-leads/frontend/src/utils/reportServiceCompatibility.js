import { REPORT_SERVICE_OPTIONS } from "../constants/reportServices.js";

const SERVICE_LABEL_MAP = new Map(REPORT_SERVICE_OPTIONS.map((service) => [service.id, service.label]));

const OPPORTUNITY_SERVICE_MAP = {
  automation: [
    ["whatsapp_automation", 4.2],
    ["crm_lead_management", 3.8],
    ["ai_chatbot", 3.4]
  ],
  "booking system": [
    ["appointment_booking", 4.5],
    ["lead_generation", 3.1],
    ["conversion_rate_optimisation", 2.8]
  ],
  analytics: [
    ["lead_generation", 3.4],
    ["conversion_rate_optimisation", 3.2],
    ["crm_lead_management", 2.7]
  ],
  "local seo": [
    ["seo", 4.6],
    ["google_business_profile", 4.1]
  ],
  seo: [
    ["seo", 4.8],
    ["google_business_profile", 2.9]
  ],
  branding: [
    ["branding_positioning", 4.4],
    ["website_redesign", 2.7]
  ],
  ecommerce: [
    ["ecommerce_improvement", 4.8],
    ["conversion_rate_optimisation", 3.2],
    ["seo", 2.4]
  ],
  "landing page": [
    ["lead_generation", 4.3],
    ["conversion_rate_optimisation", 3.8],
    ["website_redesign", 2.6]
  ],
  "website redesign": [
    ["website_redesign", 4.8],
    ["branding_positioning", 3.2],
    ["conversion_rate_optimisation", 2.5]
  ]
};

const INDUSTRY_SERVICE_MAP = [
  {
    match: /(dental|orthodont|medical|clinic|beauty|aesthetic|health)/i,
    services: [
      ["appointment_booking", 3.9],
      ["lead_generation", 3.5],
      ["google_business_profile", 3.2],
      ["website_redesign", 2.8],
      ["whatsapp_automation", 2.6],
      ["seo", 2.5]
    ],
    reason: "appointment-driven local businesses usually benefit from booking flow, enquiry capture, and local visibility improvements"
  },
  {
    match: /(restaurant|cafe|food|bar|bistro)/i,
    services: [
      ["google_business_profile", 4.1],
      ["appointment_booking", 3.3],
      ["social_media_content", 3.1],
      ["website_redesign", 2.7],
      ["lead_generation", 2.6]
    ],
    reason: "hospitality businesses usually rely on local discovery, social proof, and a quick route to reserve or enquire"
  },
  {
    match: /(professional|legal|accounting|finance|corporate|consulting|b2b)/i,
    services: [
      ["seo", 3.8],
      ["branding_positioning", 3.5],
      ["website_redesign", 3.1],
      ["lead_generation", 3],
      ["crm_lead_management", 2.6]
    ],
    reason: "service-led businesses usually need clearer positioning, search visibility, and a stronger path from interest to enquiry"
  },
  {
    match: /(retail|ecommerce|shop|store)/i,
    services: [
      ["ecommerce_improvement", 4.6],
      ["conversion_rate_optimisation", 3.8],
      ["seo", 3],
      ["ai_chatbot", 2.4]
    ],
    reason: "commerce businesses usually benefit from stronger product trust, checkout flow, and search visibility"
  },
  {
    match: /(home service|contractor|plumb|electric|roof|hvac|renovation|repair|cleaning)/i,
    services: [
      ["google_business_profile", 4.1],
      ["seo", 3.7],
      ["lead_generation", 3.6],
      ["whatsapp_automation", 3.2],
      ["website_redesign", 2.7]
    ],
    reason: "local service businesses usually need better map visibility, fast enquiries, and clearer contact routes"
  }
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function addScore(scoreMap, reasonMap, id, amount, reason) {
  scoreMap.set(id, (scoreMap.get(id) || 0) + amount);
  const current = reasonMap.get(id) || [];
  if (reason && !current.includes(reason)) {
    current.push(reason);
    reasonMap.set(id, current);
  }
}

function primaryIndustry(lead = {}) {
  return clean(lead?.industryRef?.name || lead?.industry || lead?.businessType || "");
}

export function analyzeCompatibleReportServices(lead = {}) {
  const scoreMap = new Map();
  const reasonMap = new Map();
  const company = clean(lead?.company || "this business");
  const industry = primaryIndustry(lead);
  const opportunities = Array.isArray(lead?.serviceOpportunities) ? lead.serviceOpportunities : [];

  for (const service of REPORT_SERVICE_OPTIONS) {
    addScore(scoreMap, reasonMap, service.id, 0.5, "a well-rounded website audit usually starts with clarity, visibility, and conversion angles");
  }

  for (const opportunity of opportunities) {
    const name = clean(opportunity?.service?.name).toLowerCase();
    const matches = OPPORTUNITY_SERVICE_MAP[name];
    if (!matches?.length) continue;
    const baseWeight = Number(opportunity?.score || 0) + (opportunity?.recommended ? 2.5 : 0);
    for (const [serviceId, multiplier] of matches) {
      addScore(
        scoreMap,
        reasonMap,
        serviceId,
        baseWeight * multiplier,
        `${opportunity?.service?.name || "service opportunity"} already scored ${opportunity?.score || 0}/10${opportunity?.recommended ? " and is marked as a primary recommendation" : ""}`
      );
    }
  }

  const industryRule = INDUSTRY_SERVICE_MAP.find((rule) => rule.match.test(industry));
  if (industryRule) {
    for (const [serviceId, amount] of industryRule.services) {
      addScore(scoreMap, reasonMap, serviceId, amount * 3, `${industry || "this industry"} businesses often need ${industryRule.reason}`);
    }
  }

  if (!opportunities.length) {
    addScore(scoreMap, reasonMap, "website_redesign", 6, "there are no saved service opportunities yet, so this starts from core website improvement angles");
    addScore(scoreMap, reasonMap, "seo", 5, "there are no saved service opportunities yet, so search visibility is still a safe fit");
    addScore(scoreMap, reasonMap, "lead_generation", 5, "there are no saved service opportunities yet, so enquiry conversion is still a safe fit");
  }

  const ranked = [...scoreMap.entries()]
    .map(([id, score]) => ({
      id,
      label: SERVICE_LABEL_MAP.get(id) || id,
      score: Math.round(score),
      reasons: (reasonMap.get(id) || []).slice(0, 2)
    }))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

  const selectedIds = ranked.slice(0, 4).map((item) => item.id);
  const matches = ranked.slice(0, 6);

  return {
    company,
    industry,
    selectedIds,
    matches,
    summary: matches.length
      ? `Compatible services for ${company}${industry ? ` in ${industry}` : ""} based on saved service opportunities and business type.`
      : `No strong service fit was detected yet for ${company}, so core website services were suggested instead.`
  };
}
