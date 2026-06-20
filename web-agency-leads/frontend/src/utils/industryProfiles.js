export const industryProfiles = [
  {
    slug: "beauty-aesthetics",
    name: "Beauty & Aesthetics",
    keywords: "aesthetic clinic, beauty salon, medical spa, skin clinic, facial spa, laser clinic",
    auditFocus: "Booking, visuals, reviews, Instagram, before/after proof"
  },
  {
    slug: "dental",
    name: "Dental",
    keywords: "dental clinic, dentist, orthodontist, cosmetic dentist, family dentist",
    auditFocus: "Trust, doctors, booking, compliance, reviews"
  },
  {
    slug: "medical-clinics",
    name: "Medical Clinics",
    keywords: "medical clinic, health clinic, specialist clinic, family clinic, GP clinic",
    auditFocus: "Trust, doctors, booking, compliance, reviews"
  },
  {
    slug: "restaurants",
    name: "Restaurants",
    keywords: "restaurant, cafe, bistro, dining, bar, food business",
    auditFocus: "Menu, reservations, delivery, mobile"
  },
  {
    slug: "home-services",
    name: "Home Services",
    keywords: "contractor, plumber, electrician, cleaning service, renovation contractor, moving company",
    auditFocus: "Trust, local SEO, quote CTA, reviews"
  },
  {
    slug: "legal",
    name: "Legal",
    keywords: "law firm, lawyer, legal services, solicitor, attorney",
    auditFocus: "Credibility, practice areas, contact CTA"
  },
  {
    slug: "interior-design",
    name: "Interior Design",
    keywords: "interior designer, interior design studio, renovation design, home styling",
    auditFocus: "Portfolio, gallery, premium feel"
  },
  {
    slug: "professional-services",
    name: "Professional Services",
    keywords: "consultant, accounting firm, advisory firm, professional services, B2B services",
    auditFocus: "Credibility, positioning, lead capture, trust"
  }
];

export const exclusionOptions = [
  { value: "universities", label: "Universities", keywords: "university, college, school, academy, institute, polytechnic" },
  { value: "government", label: "Government", keywords: "government, ministry, municipal, council, embassy, authority, public agency" },
  { value: "nonprofits", label: "Nonprofits", keywords: "nonprofit, non-profit, charity, foundation, association, ngo" },
  { value: "huge_enterprises", label: "Huge enterprises", keywords: "corporation, holdings, group, global, international headquarters" },
  { value: "top_tier", label: "Top-tier companies over $100B", keywords: "google, apple, microsoft, amazon, meta, alphabet, tesla, nvidia, samsung, tencent, alibaba" },
  { value: "directories", label: "Directories", keywords: "directory, marketplace, listing, listings, yellow pages, yelp, tripadvisor" },
  { value: "agencies", label: "Agencies", keywords: "agency, marketing agency, web design, seo agency, creative agency" },
  { value: "social_only", label: "Social-media-only businesses", keywords: "facebook.com, instagram.com, linktr.ee, tiktok.com, wa.me" }
];

export function profileBySlug(slug) {
  return industryProfiles.find((profile) => profile.slug === slug) || industryProfiles[0];
}

export function exclusionKeywords(selected = []) {
  return exclusionOptions
    .filter((option) => selected.includes(option.value))
    .map((option) => option.keywords)
    .join(", ");
}
