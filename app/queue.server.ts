import { Queue } from "bullmq";
import IORedis from "ioredis";

// Shared Redis connection for BullMQ.
// BullMQ requires maxRetriesPerRequest: null on the connection it uses for blocking commands.
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set. Point it at your Upstash (or local) Redis instance.");
}

export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  // Upstash requires TLS; rediss:// URLs enable it automatically. This is a safety net.
  ...(redisUrl.startsWith("rediss://") ? { tls: {} } : {}),
});

export const RESTOCK_QUEUE = "restock";

export type RestockJob = {
  shop: string;
  inventoryItemId: string;
  available: number;
};

// Reuse one Queue instance across hot reloads in dev.
declare global {
  var restockQueueGlobal: Queue<RestockJob> | undefined;
}

export const restockQueue =
  global.restockQueueGlobal ??
  new Queue<RestockJob>(RESTOCK_QUEUE, { connection });

if (process.env.NODE_ENV !== "production") {
  global.restockQueueGlobal = restockQueue;
}
