import app from "./app.js";
import { prisma } from "./repositories/prisma.js";

const port = Number(process.env.PORT || 4000);

const server = app.listen(port, () => {
  console.log(`Lead dashboard API running on http://localhost:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
