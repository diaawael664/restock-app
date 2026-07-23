/**
 * Isolated proof of the webhook HMAC gate — needs NO database or Redis, because
 * authenticate.webhook validates the signature BEFORE it ever touches session storage.
 * Run: npx tsx scripts/prove-hmac.ts
 */
import { createHmac } from "node:crypto";

const SECRET = "prove_hmac_secret";
process.env.SHOPIFY_API_SECRET = SECRET;
process.env.SHOPIFY_API_KEY ||= "test_api_key";
process.env.SHOPIFY_APP_URL ||= "https://prove.test";
process.env.SCOPES ||= "read_products,read_inventory";
// Dummy infra URLs so the modules import (connections are lazy). The invalid-HMAC path
// returns 401 before either is ever contacted; the valid path only reaches the (unreachable) DB.
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";
process.env.DATABASE_URL ||= "postgresql://u:p@127.0.0.1:5432/db";

const { action } = await import("../app/routes/webhooks.inventory_levels.update");

const payload = JSON.stringify({ inventory_item_id: 123, location_id: 1, available: 5 });
const url = "https://prove.test/webhooks/inventory_levels/update";
const headers = (hmac: string) => ({
  "content-type": "application/json",
  "x-shopify-topic": "inventory_levels/update",
  "x-shopify-hmac-sha256": hmac,
  "x-shopify-shop-domain": "prove.myshopify.com",
  "x-shopify-api-version": "2025-01",
  "x-shopify-webhook-id": "prove-1",
});

async function invoke(hmac: string): Promise<{ status: number; err?: string }> {
  try {
    const res: any = await action({
      request: new Request(url, { method: "POST", headers: headers(hmac), body: payload }),
    } as any);
    return { status: res?.status ?? 0 };
  } catch (thrown: any) {
    if (thrown instanceof Response) return { status: thrown.status };
    return { status: -1, err: String(thrown?.message || thrown).split("\n")[0] };
  }
}

const bad = createHmac("sha256", "the_wrong_secret").update(payload).digest("base64");
const good = createHmac("sha256", SECRET).update(payload).digest("base64");

const r1 = await invoke(bad);
const invalidRejected = r1.status === 401;
console.log(`${invalidRejected ? "✔" : "✘"} invalid HMAC -> ${r1.status} (expected 401)`);

const r2 = await invoke(good);
// With a valid signature it passes HMAC and proceeds to the session/DB step, which errors
// here (no DB). The point: it is NOT rejected as 401 — the signature was accepted.
const validAccepted = r2.status !== 401;
console.log(
  `${validAccepted ? "✔" : "✘"} valid HMAC -> not 401 (accepted; then ${r2.status === -1 ? "hits DB step: " + r2.err : "status " + r2.status})`,
);

const pass = invalidRejected && validAccepted;
console.log(pass ? "\nRESULT: PASS — HMAC gate verified without infra." : "\nRESULT: FAIL");
process.exit(pass ? 0 : 1);
