import { prisma } from "../repositories/prisma.js";

export const industryProfiles = {
  "beauty-aesthetics": {
    name: "Beauty & Aesthetics",
    keywords: ["aesthetic clinic", "beauty salon", "medical spa", "skin clinic", "facial spa", "laser clinic"],
    auditCriteria: "Beauty: evaluate booking, visual polish, reviews, Instagram presence, before/after proof, mobile-first service browsing, and premium trust signals."
  },
  dental: {
    name: "Dental",
    keywords: ["dental clinic", "dentist", "orthodontist", "cosmetic dentist", "family dentist"],
    auditCriteria: "Dental/medical: evaluate trust, doctor/provider bios, appointment booking, compliance-safe messaging, reviews, insurance/payment clarity, and emergency/contact CTAs."
  },
  "medical-clinics": {
    name: "Medical Clinics",
    keywords: ["medical clinic", "health clinic", "specialist clinic", "family clinic", "GP clinic"],
    auditCriteria: "Dental/medical: evaluate trust, doctor/provider bios, appointment booking, compliance-safe messaging, reviews, clinic credibility, and contact clarity."
  },
  restaurants: {
    name: "Restaurants",
    keywords: ["restaurant", "cafe", "bistro", "dining", "bar", "food business"],
    auditCriteria: "Restaurants: evaluate menu visibility, reservation flow, delivery links, mobile experience, photography, hours/location clarity, and conversion to bookings/orders."
  },
  "home-services": {
    name: "Home Services",
    keywords: ["contractor", "plumber", "electrician", "cleaning service", "renovation contractor", "moving company"],
    auditCriteria: "Home services: evaluate trust, local SEO, quote CTA, reviews, service-area clarity, emergency/contact flow, before/after proof, and lead capture."
  },
  legal: {
    name: "Legal",
    keywords: ["law firm", "lawyer", "legal services", "solicitor", "attorney"],
    auditCriteria: "Legal: evaluate credibility, practice areas, attorney profiles, contact CTA, consultation flow, reviews, case/proof signals, and professional polish."
  },
  "interior-design": {
    name: "Interior Design",
    keywords: ["interior designer", "interior design studio", "renovation design", "home styling"],
    auditCriteria: "Interior design: evaluate portfolio depth, gallery quality, premium feel, enquiry CTA, project process, testimonials, and visual storytelling."
  },
  "professional-services": {
    name: "Professional Services",
    keywords: ["consultant", "accounting firm", "advisory firm", "professional services", "B2B services"],
    auditCriteria: "Professional services: evaluate credibility, positioning, lead capture, trust, service clarity, case studies, and conversion path."
  }
};

export const exclusionProfiles = {
  universities: ["university", "college", "school", "academy", "institute", "polytechnic"],
  government: ["government", "ministry", "municipal", "council", "embassy", "authority", "public agency"],
  nonprofits: ["nonprofit", "non-profit", "charity", "foundation", "association", "ngo"],
  huge_enterprises: ["corporation", "holdings", "group", "global", "international headquarters"],
  top_tier: ["google", "apple", "microsoft", "amazon", "meta", "alphabet", "tesla", "nvidia", "samsung", "tencent", "alibaba"],
  directories: ["directory", "marketplace", "listing", "listings", "yellow pages", "yelp", "tripadvisor"],
  agencies: ["agency", "marketing agency", "web design", "seo agency", "creative agency"],
  social_only: ["facebook.com", "instagram.com", "linktr.ee", "tiktok.com", "wa.me"]
};

export function getIndustryProfile(slug) {
  return industryProfiles[slug] || industryProfiles["professional-services"];
}

export async function getIndustryProfileConfig(slug) {
  const fallback = getIndustryProfile(slug);
  if (!slug) return fallback;
  const industry = await prisma.industry.findUnique({ where: { slug } }).catch(() => null);
  if (!industry) return fallback;
  return {
    name: industry.name || fallback.name,
    keywords: industry.defaultKeywords
      ? String(industry.defaultKeywords).split(/,|\n/g).map((keyword) => keyword.trim()).filter(Boolean)
      : fallback.keywords,
    auditCriteria: industry.auditCriteria || fallback.auditCriteria
  };
}

export function industryKeywords(slug) {
  return getIndustryProfile(slug).keywords.join(", ");
}

export function auditCriteriaFor(input = {}) {
  return getIndustryProfile(input.industrySlug).auditCriteria;
}

export function exclusionKeywords(values = []) {
  return values.flatMap((value) => exclusionProfiles[value] || []);
}
