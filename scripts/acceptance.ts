/**
 * npm run test:acceptance
 *
 * Proves the core product path WITHOUT clicking through Shopify admin:
 *   seed subscriber -> POST inventory_levels/update (0->5) at the real route with a
 *   VALID HMAC -> job enqueued -> real worker process consumes it -> alert "sent".
 *
 * What's real: the webhook route, HMAC verification, Redis/BullMQ enqueue, the worker
 * process, the DB writes. What's faked: the Shopify signing secret (we control it — that's
 * exactly what HMAC proves) and the Resend network call (EMAIL_DRY_RUN records instead of
 * sending, so tests never blast real mail; `npm run verify` pings the real Resend key).
 *
 * Hard requirements: reachable Postgres + Redis. Without them this prints BLOCKED.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Deterministic test env — set BEFORE importing any app module ──
const SECRET = "acceptance_test_webhook_secret";
process.env.SHOPIFY_API_SECRET = SECRET;
process.env.SHOPIFY_API_KEY ||= "test_api_key";
process.env.SHOPIFY_APP_URL ||= "https://acceptance.test";
process.env.SCOPES ||= "read_products,read_inventory";
process.env.EMAIL_DRY_RUN = "1";
const DRY_LOG = join(tmpdir(), `restock-acceptance-${Date.now()}.log`);
process.env.EMAIL_DRY_RUN_LOG = DRY_LOG;
writeFileSync(DRY_LOG, "");

const PLACEHOLDER = /example\.com|your-|user:pass|re_xxxxxxxx|:password@|PASTE_HERE|<.*>/i;
function blocked(name: string, v?: string) {
  return !v || v.trim() === "" || PLACEHOLDER.test(v);
}

const steps: { name: string; ok: boolean; note?: string }[] = [];
function step(name: string, ok: boolean, note = "") {
  steps.push({ name, ok, note });
  console.log(`${ok ? "✔" : "✘"} ${name}${note ? "  — " + note : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── Preconditions ──
  if (blocked("DATABASE_URL", process.env.DATABASE_URL) || blocked("REDIS_URL", process.env.REDIS_URL)) {
    console.log("\nBLOCKED: test:acceptance needs a reachable Postgres and Redis.");
    console.log("  DATABASE_URL:", process.env.DATABASE_URL ? "(set)" : "MISSING");
    console.log("  REDIS_URL   :", process.env.REDIS_URL ? "(set)" : "MISSING");
    console.log("Fill both in .env (see .env.example), run `npm run verify`, then retry.\n");
    process.exit(2);
  }

  // Make sure tables exist (idempotent; needs the DB that the preconditions confirmed is configured).
  console.log("Ensuring schema is present (prisma db push)…");
  const push = spawnSync("npx prisma db push --skip-generate --accept-data-loss", { stdio: "inherit", shell: true });
  if (push.status !== 0) {
    console.log("\nFAIL: could not sync schema to the database. Is DATABASE_URL reachable?\n");
    process.exit(1);
  }

  const { default: prisma } = await import("../app/db.server");
  const { restockQueue } = await import("../app/queue.server");
  const { action } = await import("../app/routes/webhooks.inventory_levels.update");

  const shopDomain = "acceptance-test.myshopify.com";
  const inventoryItemId = "99900001";
  const variantId = "88800001";
  const email = "buyer@example.com";

  let worker: ReturnType<typeof spawn> | null = null;
  let failed = false;

  try {
    // ── Seed ──
    await prisma.shop.deleteMany({ where: { shopDomain } }); // clean slate (cascades)
    const shop = await prisma.shop.create({
      data: { shopDomain, active: true, plan: "free", minThreshold: 1, fromName: "Acceptance Store" },
    });
    await prisma.subscriber.create({
      data: {
        shopId: shop.id, email, variantId, inventoryItemId,
        productId: "77700001", productTitle: "Acceptance Test Hoodie",
        variantTitle: "Large / Black", productHandle: "acceptance-test-hoodie", price: "$49.00",
      },
    });
    step("seed: shop + pending subscriber created", true, `${email} waiting on item ${inventoryItemId}`);

    // ── Build the restock payload (0 -> 5) ──
    const payload = JSON.stringify({
      inventory_item_id: Number(inventoryItemId), location_id: 1, available: 5,
      updated_at: new Date().toISOString(),
    });
    const headers = (hmac: string) => ({
      "content-type": "application/json",
      "x-shopify-topic": "inventory_levels/update",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-shop-domain": shopDomain,
      "x-shopify-api-version": "2025-01",
      "x-shopify-webhook-id": "acceptance-test-1",
    });
    const validHmac = createHmac("sha256", SECRET).update(payload, "utf8").digest("base64");
    const badHmac = createHmac("sha256", "wrong_secret").update(payload, "utf8").digest("base64");
    const url = "https://acceptance.test/webhooks/inventory_levels/update";

    // ── Negative: invalid HMAC must be rejected 401 BEFORE any enqueue ──
    const beforeBad = await restockQueue.getJobCounts("waiting", "active");
    let badStatus = 0;
    try {
      const res: any = await action({ request: new Request(url, { method: "POST", headers: headers(badHmac), body: payload }) } as any);
      badStatus = res?.status ?? 200;
    } catch (thrown: any) {
      badStatus = thrown?.status ?? (thrown instanceof Response ? thrown.status : 0);
    }
    const afterBad = await restockQueue.getJobCounts("waiting", "active");
    const noEnqueueOnBad = afterBad.waiting + afterBad.active === beforeBad.waiting + beforeBad.active;
    step("invalid HMAC -> 401, no enqueue", badStatus === 401 && noEnqueueOnBad, `status=${badStatus}`);
    if (!(badStatus === 401 && noEnqueueOnBad)) failed = true;

    // ── Positive: valid HMAC -> fast 200 + job enqueued ──
    const before = await restockQueue.getJobCounts("waiting", "active");
    const t0 = Date.now();
    const okRes: any = await action({ request: new Request(url, { method: "POST", headers: headers(validHmac), body: payload }) } as any);
    const ms = Date.now() - t0;
    const okStatus = okRes?.status ?? 0;
    step("valid HMAC -> 200 (fast)", okStatus === 200 && ms < 2000, `status=${okStatus}, ${ms}ms`);
    if (okStatus !== 200) failed = true;

    const after = await restockQueue.getJobCounts("waiting", "active");
    const enqueued = after.waiting + after.active > before.waiting + before.active;
    step("job enqueued to Redis", enqueued, `waiting ${before.waiting}->${after.waiting}`);
    if (!enqueued) failed = true;

    // ── Run the REAL worker process; it should consume the job ──
    console.log("Starting worker subprocess (npx tsx worker.ts)…");
    worker = spawn("npx tsx worker.ts", {
      shell: true,
      env: { ...process.env }, // carries DATABASE_URL, REDIS_URL, EMAIL_DRY_RUN, EMAIL_DRY_RUN_LOG
      stdio: "inherit",
    });

    // Poll for the worker's effects (cross-process, observed via DB).
    let processed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const sub = await prisma.subscriber.findFirst({ where: { shopId: shop.id, email } });
      const alerts = await prisma.alert.count({ where: { shopId: shop.id } });
      if (sub?.status === "notified" && alerts >= 1) { processed = true; break; }
    }
    step("worker processed: subscriber notified + Alert row", processed);
    if (!processed) failed = true;

    // ── Assert the alert email was produced with the right content ──
    const lines = existsSync(DRY_LOG) ? readFileSync(DRY_LOG, "utf8").trim().split("\n").filter(Boolean) : [];
    const sent = lines.map((l) => JSON.parse(l));
    const alertMail = sent.find((m) => m.type === "alert" && m.to === email);
    const contentOk = !!alertMail && /back in stock/i.test(alertMail.subject);
    step("alert email sent with correct recipient + subject", contentOk, alertMail ? `subject="${alertMail.subject}"` : "no alert email recorded");
    if (!contentOk) failed = true;
  } catch (e: any) {
    step("unexpected error", false, String(e?.message || e));
    failed = true;
  } finally {
    // Kill the worker subprocess (tree kill on Windows).
    if (worker?.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(worker.pid), "/T", "/F"], { stdio: "ignore" });
      else worker.kill("SIGTERM");
    }
    try { await prisma.shop.deleteMany({ where: { shopDomain } }); } catch {}
    try { await restockQueue.close(); } catch {}
    try { await prisma.$disconnect(); } catch {}
  }

  console.log("\n════════ acceptance summary ════════");
  for (const s of steps) console.log(`${s.ok ? "✔" : "✘"} ${s.name}`);
  console.log("════════════════════════════════════");
  console.log(failed ? "RESULT: FAIL\n" : "RESULT: PASS — core restock path works end to end.\n");
  process.exit(failed ? 1 : 0);
}

main();
