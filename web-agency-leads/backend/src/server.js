import app from "./app.js";
import { prisma } from "./repositories/prisma.js";
import { startAutomationScheduler, stopAutomationScheduler } from "./services/automationService.js";
import { startGmailReplyScheduler, stopGmailReplyScheduler } from "./services/gmailReplyScheduler.service.js";

const port = Number(process.env.PORT || 4000);

const server = app.listen(port, () => {
  console.log(`Lead dashboard API running on http://localhost:${port}`);
  startAutomationScheduler();
  startGmailReplyScheduler();
});

async function shutdown() {
  stopAutomationScheduler();
  stopGmailReplyScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
