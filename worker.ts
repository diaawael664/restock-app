/**
 * Persistent restock worker.
 *
 * The ONLY thing between "merchant restocks" and "email sent". No cron, no polling.
 * Run alongside the web process:  npm run worker  (dev)  /  npm run worker:start  (prod)
 */
import "dotenv/config";
import { Worker } from "bullmq";
import prisma from "./app/db.server";
import { sendRestockEmail } from "./app/email.server";
import { connection, RESTOCK_QUEUE, type RestockJob } from "./app/queue.server";

const FREE_MONTHLY_CAP = 50;
const CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

const worker = new Worker<RestockJob>(
  RESTOCK_QUEUE,
  async (job) => {
    const { shop, inventoryItemId, available } = job.data;

    const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    if (!shopRow || !shopRow.active) return;
    if (available < shopRow.minThreshold) return; // "don't email 500 people for 2 units"

    const waiting = await prisma.subscriber.findMany({
      where: { shopId: shopRow.id, inventoryItemId, status: "pending" },
      orderBy: { createdAt: "asc" }, // fairest: first in line, first notified
    });
    if (waiting.length === 0) return;

    // Roll the monthly usage window if the cycle has elapsed.
    let alertsSentMonth = shopRow.alertsSentMonth;
    if (Date.now() - shopRow.cycleResetAt.getTime() >= CYCLE_MS) {
      alertsSentMonth = 0;
      await prisma.shop.update({
        where: { id: shopRow.id },
        data: { alertsSentMonth: 0, cycleResetAt: new Date() },
      });
    }

    const isPro = shopRow.plan === "pro";
    let remaining = isPro ? Infinity : Math.max(0, FREE_MONTHLY_CAP - alertsSentMonth);
    let sentCount = 0;

    for (const sub of waiting) {
      if (remaining <= 0) break; // hold the rest; the admin sees "cap reached — upgrade"
      try {
        await sendRestockEmail(shopRow, sub);
        await prisma.subscriber.update({
          where: { id: sub.id },
          data: { status: "notified", notifiedAt: new Date() },
        });
        await prisma.alert.create({
          data: { shopId: shopRow.id, subscriberId: sub.id, variantId: sub.variantId },
        });
        sentCount++;
        remaining--;
      } catch (err) {
        console.error(`[restock] send failed for ${sub.id}:`, err);
        await prisma.subscriber.update({
          where: { id: sub.id },
          data: { status: "failed" },
        });
      }
    }

    if (!isPro && sentCount > 0) {
      await prisma.shop.update({
        where: { id: shopRow.id },
        data: { alertsSentMonth: { increment: sentCount } },
      });
    }

    console.log(
      `[restock] ${shop} item=${inventoryItemId} waiting=${waiting.length} sent=${sentCount}`,
    );
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error(`[restock] job ${job?.id} failed:`, err);
});

console.log("[restock] worker up, listening for restock jobs…");

// Graceful shutdown so in-flight sends finish before the process exits.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`[restock] ${sig} received, draining…`);
    await worker.close();
    await connection.quit();
    process.exit(0);
  });
}
