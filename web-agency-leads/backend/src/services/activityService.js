import { prisma } from "../repositories/prisma.js";

export async function listActivity() {
  const [stageChanges, notes] = await Promise.all([
    prisma.leadStatusHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        lead: { select: { id: true, company: true, priority: true, pipelineStage: true } },
        user: { select: { id: true, name: true, email: true } }
      }
    }),
    prisma.leadNote.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        lead: { select: { id: true, company: true, priority: true, pipelineStage: true } },
        user: { select: { id: true, name: true, email: true } }
      }
    })
  ]);

  return [
    ...stageChanges.map((item) => ({
      id: item.id,
      type: "STAGE_CHANGED",
      lead: item.lead,
      user: item.user,
      oldStage: item.oldStage,
      newStage: item.newStage,
      oldStatus: item.oldStatus,
      newStatus: item.newStatus,
      createdAt: item.createdAt
    })),
    ...notes.map((item) => ({
      id: item.id,
      type: "NOTE",
      lead: item.lead,
      user: item.user,
      note: item.note,
      createdAt: item.createdAt
    }))
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 40);
}
