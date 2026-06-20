import { prisma } from "../repositories/prisma.js";
import { defaultIndustries, defaultServices } from "./catalogDefaults.js";

export async function ensureDefaultCatalog() {
  const [industryCount, serviceCount] = await Promise.all([
    prisma.industry.count(),
    prisma.agencyService.count()
  ]);

  if (industryCount === defaultIndustries.length && serviceCount === defaultServices.length) {
    return;
  }

  for (const industry of defaultIndustries) {
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

  for (const service of defaultServices) {
    await prisma.agencyService.upsert({
      where: { slug: service.slug },
      update: service,
      create: service
    });
  }
}
