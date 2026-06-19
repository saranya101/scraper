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

  console.log(`Seeded ${admins.length} admin user(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
