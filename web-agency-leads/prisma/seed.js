import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const admins = [
  {
    name: process.env.ADMIN_1_NAME,
    email: process.env.ADMIN_1_EMAIL,
    password: process.env.ADMIN_1_PASSWORD
  },
  {
    name: process.env.ADMIN_2_NAME,
    email: process.env.ADMIN_2_EMAIL,
    password: process.env.ADMIN_2_PASSWORD
  }
].filter((admin) => admin.name && admin.email && admin.password);

const industries = [
  {
    name: "Beauty & Aesthetics",
    slug: "beauty-aesthetics",
    description: "Beauty salons, aesthetics clinics, nail salons, spas, and wellness businesses.",
    rule: { designWeight: 1.4, mobileWeight: 1.35, trustWeight: 1.2, ctaWeight: 1.25, seoWeight: 0.9, conversionWeight: 1.2, bookingWeight: 1.5, socialProofWeight: 1.35 }
  },
  {
    name: "Dental",
    slug: "dental",
    description: "Dental clinics and orthodontic practices.",
    rule: { designWeight: 1, mobileWeight: 1.2, trustWeight: 1.6, ctaWeight: 1.25, seoWeight: 1.1, conversionWeight: 1.3, bookingWeight: 1.45, socialProofWeight: 1.35 }
  },
  {
    name: "Medical Clinics",
    slug: "medical-clinics",
    description: "Primary care, specialist, and healthcare clinics.",
    rule: { designWeight: 1, mobileWeight: 1.15, trustWeight: 1.7, ctaWeight: 1.2, seoWeight: 1.05, conversionWeight: 1.25, bookingWeight: 1.4, socialProofWeight: 1.25 }
  },
  {
    name: "Interior Design",
    slug: "interior-design",
    description: "Interior designers, renovation firms, and studios.",
    rule: { designWeight: 1.6, mobileWeight: 1.1, trustWeight: 1.25, ctaWeight: 1.15, seoWeight: 1, conversionWeight: 1.25, bookingWeight: 0.85, socialProofWeight: 1.45 }
  },
  {
    name: "Home Services",
    slug: "home-services",
    description: "Contractors, cleaners, movers, electricians, plumbers, and local trades.",
    rule: { designWeight: 0.95, mobileWeight: 1.2, trustWeight: 1.45, ctaWeight: 1.5, seoWeight: 1.55, conversionWeight: 1.4, bookingWeight: 1.1, socialProofWeight: 1.35 }
  },
  {
    name: "Restaurants",
    slug: "restaurants",
    description: "Restaurants, cafes, bars, and food businesses.",
    rule: { designWeight: 1.25, mobileWeight: 1.55, trustWeight: 1, ctaWeight: 1.2, seoWeight: 1.15, conversionWeight: 1.15, bookingWeight: 1.45, socialProofWeight: 1.3 }
  },
  {
    name: "Legal",
    slug: "legal",
    description: "Law firms and legal practices.",
    rule: { designWeight: 1, mobileWeight: 1.05, trustWeight: 1.75, ctaWeight: 1.25, seoWeight: 1.25, conversionWeight: 1.35, bookingWeight: 0.9, socialProofWeight: 1.2 }
  },
  {
    name: "Professional Services",
    slug: "professional-services",
    description: "Consultants, accountants, agencies, B2B firms, and advisors.",
    rule: { designWeight: 1.15, mobileWeight: 1.05, trustWeight: 1.45, ctaWeight: 1.25, seoWeight: 1.2, conversionWeight: 1.35, bookingWeight: 0.9, socialProofWeight: 1.15 }
  }
];

const services = [
  { name: "Website redesign", slug: "website-redesign", description: "Modernize the full website experience and conversion journey.", baseMinValue: 3000, baseMaxValue: 9000 },
  { name: "Landing page", slug: "landing-page", description: "Build focused campaign or offer pages.", baseMinValue: 1200, baseMaxValue: 4000 },
  { name: "SEO", slug: "seo", description: "Improve technical and content search visibility.", baseMinValue: 1000, baseMaxValue: 4500 },
  { name: "Local SEO", slug: "local-seo", description: "Improve local search, maps, and location-intent discovery.", baseMinValue: 800, baseMaxValue: 3500 },
  { name: "Branding", slug: "branding", description: "Improve visual identity, positioning, and trust signals.", baseMinValue: 2000, baseMaxValue: 8000 },
  { name: "Ecommerce", slug: "ecommerce", description: "Add or improve online sales flows.", baseMinValue: 4000, baseMaxValue: 15000 },
  { name: "Booking system", slug: "booking-system", description: "Add bookings, appointments, and conversion automation.", baseMinValue: 1500, baseMaxValue: 6000 },
  { name: "Analytics", slug: "analytics", description: "Install measurement, dashboards, and conversion tracking.", baseMinValue: 800, baseMaxValue: 3000 },
  { name: "Automation", slug: "automation", description: "Automate lead capture, routing, follow-up, and admin work.", baseMinValue: 2000, baseMaxValue: 9000 },
  { name: "Maintenance", slug: "maintenance", description: "Ongoing site care, updates, performance, and support.", baseMinValue: 500, baseMaxValue: 2500 }
];

function priorityFromScore(score) {
  if (score <= 4) return "HOT";
  if (score <= 6) return "WARM";
  return "COLD";
}

async function main() {
  if (!admins.length) {
    throw new Error("No admin users configured. Add ADMIN_* variables to .env.");
  }

  for (const admin of admins) {
    const passwordHash = await bcrypt.hash(admin.password, 12);
    await prisma.user.upsert({
      where: { email: admin.email.toLowerCase() },
      update: { name: admin.name, passwordHash, role: "ADMIN" },
      create: {
        name: admin.name,
        email: admin.email.toLowerCase(),
        passwordHash,
        role: "ADMIN"
      }
    });
  }

  for (const industry of industries) {
    const savedIndustry = await prisma.industry.upsert({
      where: { slug: industry.slug },
      update: { name: industry.name, description: industry.description },
      create: { name: industry.name, slug: industry.slug, description: industry.description }
    });
    await prisma.industryScoringRule.upsert({
      where: { industryId: savedIndustry.id },
      update: industry.rule,
      create: { industryId: savedIndustry.id, ...industry.rule }
    });
  }

  for (const service of services) {
    await prisma.agencyService.upsert({
      where: { slug: service.slug },
      update: service,
      create: service
    });
  }

  const leadCount = await prisma.lead.count();
  if (leadCount === 0) {
    const samples = [
      {
        company: "The Aesthetics Medical Clinic",
        website: "https://www.tamc.com.sg/",
        phone: "6316 5282",
        address: "91 Bukit Batok West Ave 2, Singapore",
        industry: "Aesthetic clinic",
        score: 3,
        issues: ["Outdated visual hierarchy", "Weak mobile conversion path", "Slow first impression above the fold"]
      },
      {
        company: "Mode Aesthetics",
        website: "https://www.modeaesthetics.com.sg/",
        phone: "9232 9006",
        address: "50 Jurong Gateway Rd, Singapore",
        industry: "Aesthetic clinic",
        score: 5,
        issues: ["Inconsistent spacing", "Service pages need clearer CTAs"]
      },
      {
        company: "Hills Aesthetics Clinic",
        website: "https://www.hillsaestheticsclinic.com.sg/",
        phone: "9235 0988",
        address: "Jem Mall, Singapore",
        industry: "Aesthetic clinic",
        score: 8,
        issues: ["Could improve trust proof and page structure"]
      }
    ];

    for (const lead of samples) {
      await prisma.lead.create({
        data: {
          company: lead.company,
          website: lead.website,
          phone: lead.phone,
          address: lead.address,
          industry: lead.industry,
          score: lead.score,
          priority: priorityFromScore(lead.score),
          outreachEmail: `Hi ${lead.company} team,\n\nI noticed a few opportunities to make your website feel more premium and convert more visitors into enquiries. Would you be open to a short redesign audit?`,
          issues: {
            create: lead.issues.map((issueText) => ({ issueText }))
          }
        }
      });
    }
  }

  console.log(`Seeded ${admins.length} admin user(s), ${industries.length} industries, and ${services.length} services.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
