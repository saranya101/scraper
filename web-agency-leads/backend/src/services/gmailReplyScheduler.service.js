import { activeEmailProvider } from "./emailService.js";
import { syncGmailReplies } from "./gmailReplySync.service.js";

let schedulerTimer = null;
let running = false;

async function runScheduledSync() {
  if (running) return;
  running = true;
  try {
    await syncGmailReplies({ source: "scheduler" });
  } catch (error) {
    console.error("Scheduled Gmail reply sync failed:", error.message || error);
  } finally {
    running = false;
  }
}

export function startGmailReplyScheduler() {
  if (schedulerTimer || process.env.GMAIL_REPLY_SYNC_DISABLED === "true" || activeEmailProvider() !== "GMAIL") return;
  const intervalMs = Number(process.env.GMAIL_REPLY_SYNC_INTERVAL_MS || 300000);
  schedulerTimer = setInterval(() => {
    runScheduledSync().catch(() => {});
  }, intervalMs);
  runScheduledSync().catch(() => {});
}

export function stopGmailReplyScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}
