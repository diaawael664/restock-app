// Pings Postgres, Redis, and Resend. Prints PASS / FAIL / BLOCKED per service.
// PASS  = reachable & authenticated
// FAIL  = creds supplied but the service errored / unreachable  (exit 1)
// BLOCKED = env var missing or still the .env.example placeholder (exit 2)
import "dotenv/config";

const PLACEHOLDER = /example\.com|your-|user:pass|re_xxxxxxxx|:password@|PASTE_HERE|<.*>/i;

function classify(name, val) {
  if (!val || val.trim() === "") return { state: "BLOCKED", note: `${name} not set` };
  if (PLACEHOLDER.test(val)) return { state: "BLOCKED", note: `${name} still a placeholder` };
  return null;
}

const results = [];
const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);

// ── Postgres ──
async function checkPostgres() {
  const blocked = classify("DATABASE_URL", process.env.DATABASE_URL);
  if (blocked) return { service: "Postgres", ...blocked };
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await withTimeout(prisma.$queryRaw`SELECT 1`, 8000, "Postgres");
    await prisma.$disconnect();
    return { service: "Postgres", state: "PASS", note: "SELECT 1 ok" };
  } catch (e) {
    return { service: "Postgres", state: "FAIL", note: String(e.message || e).split("\n")[0] };
  }
}

// ── Redis ──
async function checkRedis() {
  const blocked = classify("REDIS_URL", process.env.REDIS_URL);
  if (blocked) return { service: "Redis", ...blocked };
  let redis;
  try {
    const { default: IORedis } = await import("ioredis");
    const url = process.env.REDIS_URL;
    redis = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      ...(url.startsWith("rediss://") ? { tls: {} } : {}),
    });
    await withTimeout(redis.connect(), 8000, "Redis");
    const pong = await withTimeout(redis.ping(), 4000, "Redis PING");
    await redis.quit();
    return { service: "Redis", state: pong === "PONG" ? "PASS" : "FAIL", note: `PING -> ${pong}` };
  } catch (e) {
    try { redis && redis.disconnect(); } catch {}
    return { service: "Redis", state: "FAIL", note: String(e.message || e).split("\n")[0] };
  }
}

// ── Resend ──
async function checkResend() {
  const blocked = classify("RESEND_API_KEY", process.env.RESEND_API_KEY);
  if (blocked) return { service: "Resend", ...blocked };
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    // Read-only call that requires a valid key; does not send anything.
    const { error } = await withTimeout(resend.domains.list(), 8000, "Resend");
    if (error) return { service: "Resend", state: "FAIL", note: error.message || String(error) };
    return { service: "Resend", state: "PASS", note: "API key valid (domains.list ok)" };
  } catch (e) {
    return { service: "Resend", state: "FAIL", note: String(e.message || e).split("\n")[0] };
  }
}

const checks = await Promise.all([checkPostgres(), checkRedis(), checkResend()]);
results.push(...checks);

console.log("\nConnectivity check");
console.log("──────────────────");
for (const r of results) {
  const icon = r.state === "PASS" ? "✔" : r.state === "FAIL" ? "✘" : "•";
  console.log(`${icon} ${r.service.padEnd(9)} ${r.state.padEnd(8)} ${r.note}`);
}

const anyFail = results.some((r) => r.state === "FAIL");
const anyBlocked = results.some((r) => r.state === "BLOCKED");
if (anyFail) process.exit(1);
if (anyBlocked) process.exit(2);
process.exit(0);
