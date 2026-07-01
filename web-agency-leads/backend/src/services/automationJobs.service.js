import { prisma } from "../repositories/prisma.js";

const JOBS_KEY = "outreachAutomationJobs";
const MAX_JOBS = 40;

async function readJobs() {
  const saved = await prisma.appSetting.findUnique({ where: { key: JOBS_KEY } });
  return Array.isArray(saved?.value?.jobs) ? saved.value.jobs : [];
}

async function writeJobs(jobs, userId) {
  const value = { jobs: jobs.slice(0, MAX_JOBS) };
  await prisma.appSetting.upsert({
    where: { key: JOBS_KEY },
    create: { key: JOBS_KEY, value, updatedBy: userId },
    update: { value, updatedBy: userId }
  });
  return value.jobs;
}

export async function listAutomationJobs() {
  return readJobs();
}

export async function createAutomationJob(input = {}, userId) {
  const jobs = await readJobs();
  const job = {
    id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    type: input.type || "full_automation_run",
    status: input.status || "queued",
    total: Number(input.total || 0),
    completed: Number(input.completed || 0),
    skipped: Number(input.skipped || 0),
    failed: Number(input.failed || 0),
    currentLeadId: input.currentLeadId || null,
    currentLeadName: input.currentLeadName || null,
    stage: input.stage || "Queued",
    progressPercent: Number(input.progressPercent || 0),
    startedAt: new Date().toISOString(),
    completedAt: input.completedAt || null,
    errors: Array.isArray(input.errors) ? input.errors : [],
    summary: input.summary || null
  };
  await writeJobs([job, ...jobs], userId);
  return job;
}

export async function updateAutomationJob(id, updates = {}, userId) {
  const jobs = await readJobs();
  const nextJobs = jobs.map((job) => {
    if (job.id !== id) return job;
    const next = {
      ...job,
      ...updates
    };
    if (updates.completedAt === undefined && ["completed", "failed", "cancelled"].includes(String(next.status || "").toLowerCase())) {
      next.completedAt = new Date().toISOString();
    }
    return next;
  });
  await writeJobs(nextJobs, userId);
  return nextJobs.find((job) => job.id === id) || null;
}

export async function getAutomationJob(id) {
  const jobs = await readJobs();
  return jobs.find((job) => job.id === id) || null;
}
