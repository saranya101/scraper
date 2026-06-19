import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { normalizeWebsite, priorityFromScore } from "../utils/priority.js";

const includeLead = {
  issues: { orderBy: { createdAt: "asc" } },
  notes: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  },
  statusHistory: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  },
  screenshots: { orderBy: { createdAt: "desc" } }
};

function leadData(input) {
  const score = Number(input.score ?? 7);
  return {
    company: input.company,
    website: normalizeWebsite(input.website),
    phone: input.phone || null,
    address: input.address || null,
    industry: input.industry || null,
    screenshotPath: input.screenshotPath || null,
    score,
    priority: priorityFromScore(score),
    outreachEmail: input.outreachEmail || null,
    status: input.status || "NOT_CONTACTED"
  };
}

export async function listLeads(query) {
  const page = Math.max(Number(query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || 12), 1), 100);
  const search = query.search?.trim();
  const where = {
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { company: { contains: search, mode: "insensitive" } },
            { industry: { contains: search, mode: "insensitive" } },
            { address: { contains: search, mode: "insensitive" } },
            { website: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };

  const sortBy = ["company", "score", "priority", "status", "createdAt", "updatedAt"].includes(query.sortBy)
    ? query.sortBy
    : "createdAt";
  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

  const [items, total, stats] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { issues: true, _count: { select: { notes: true } } }
    }),
    prisma.lead.count({ where }),
    getStats()
  ]);

  return {
    items,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    stats
  };
}

export async function getStats() {
  const [total, byPriority, byStatus] = await Promise.all([
    prisma.lead.count({ where: { status: { not: "ARCHIVED" } } }),
    prisma.lead.groupBy({ by: ["priority"], _count: true, where: { status: { not: "ARCHIVED" } } }),
    prisma.lead.groupBy({ by: ["status"], _count: true })
  ]);

  return {
    total,
    hot: byPriority.find((row) => row.priority === "HOT")?._count || 0,
    warm: byPriority.find((row) => row.priority === "WARM")?._count || 0,
    cold: byPriority.find((row) => row.priority === "COLD")?._count || 0,
    contacted: byStatus.find((row) => row.status === "CONTACTED")?._count || 0,
    replied: byStatus.find((row) => row.status === "REPLIED")?._count || 0
  };
}

export async function getLead(id) {
  const lead = await prisma.lead.findUnique({ where: { id }, include: includeLead });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

export async function createLead(input) {
  const data = leadData(input);
  const issues = Array.isArray(input.issues) ? input.issues.filter(Boolean) : [];
  try {
    return await prisma.lead.create({
      data: {
        ...data,
        issues: { create: issues.map((issueText) => ({ issueText })) },
        screenshots: data.screenshotPath ? { create: { imagePath: data.screenshotPath } } : undefined
      },
      include: includeLead
    });
  } catch (error) {
    if (error.code === "P2002") throw new HttpError(409, "A lead with this website already exists");
    throw error;
  }
}

export async function updateLead(id, input, userId) {
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) throw notFound("Lead not found");

  const data = leadData({ ...current, ...input });
  const statusChanged = input.status && input.status !== current.status;

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id },
      data,
      include: includeLead
    });

    if (statusChanged) {
      await tx.leadStatusHistory.create({
        data: { leadId: id, userId, oldStatus: current.status, newStatus: input.status }
      });
    }

    if (Array.isArray(input.issues)) {
      await tx.leadIssue.deleteMany({ where: { leadId: id } });
      await tx.leadIssue.createMany({
        data: input.issues.filter(Boolean).map((issueText) => ({ leadId: id, issueText }))
      });
    }

    return tx.lead.findUnique({ where: { id }, include: includeLead });
  });
}

export async function deleteLead(id) {
  await getLead(id);
  await prisma.lead.delete({ where: { id } });
}

export async function addNote({ leadId, userId, note }) {
  await getLead(leadId);
  return prisma.leadNote.create({
    data: { leadId, userId, note },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

export async function listNotes(leadId) {
  return prisma.leadNote.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}
