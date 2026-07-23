/**
 * Shopify App Pricing (formerly Managed Pricing) plan status.
 *
 * Plans live in the Partner Dashboard; Shopify hosts the plan-selection page. There
 * are NO billing webhooks, so we keep Shop.plan fresh from two signals:
 *   (a) the welcome-redirect `plan_handle` param (instant upgrade), and
 *   (b) the Partner API `activeSubscription` query (authoritative — also catches
 *       cancellations/freezes/expirations, which have no redirect and no webhook).
 *
 * The worker runs headless, so it never calls this — it reads the persisted Shop.plan.
 *
 * Canonical Shop.plan values: "free" | "pro" (lowercase). Any active App Pricing
 * contract (including the $0 private reviewer plan) counts as "pro".
 */
import prisma from "./db.server";

export const PLAN_FREE = "free";
export const PLAN_PRO = "pro";

const PARTNER_TOKEN = process.env.SHOPIFY_PARTNER_API_TOKEN;
const PARTNER_ORG = process.env.SHOPIFY_PARTNER_ORG_ID;
const APP_ID = process.env.SHOPIFY_APP_ID; // numeric Shopify App id -> gid://shopify/App/<id>
const PARTNER_API_VERSION = process.env.SHOPIFY_PARTNER_API_VERSION || "2025-01";

type AdminLike = { graphql: (query: string) => Promise<Response> };

// The shop's global id (gid://shopify/Shop/<id>) — the Partner API needs this.
async function shopGlobalId(admin: AdminLike): Promise<string | null> {
  try {
    const res = await admin.graphql(`#graphql
      query { shop { id } }`);
    return (await res.json())?.data?.shop?.id ?? null;
  } catch (err) {
    console.error("[billing] shop id lookup failed:", err);
    return null;
  }
}

// Ask the Partner API whether this shop has an active App Pricing contract for the app.
// Returns "pro" (contract exists), "free" (none), or undefined when we cannot tell
// (creds not configured, or an API error) — callers must NOT downgrade on undefined.
async function partnerPlan(shopGid: string): Promise<"pro" | "free" | undefined> {
  if (!PARTNER_TOKEN || !PARTNER_ORG || !APP_ID) return undefined;
  try {
    const res = await fetch(
      `https://partners.shopify.com/${PARTNER_ORG}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": PARTNER_TOKEN,
        },
        body: JSON.stringify({
          query: `query($appId: ID!, $shopId: ID!) {
            activeSubscription(appId: $appId, shopId: $shopId) { billingPeriod }
          }`,
          variables: { appId: `gid://shopify/App/${APP_ID}`, shopId: shopGid },
        }),
      },
    );
    const json: any = await res.json();
    if (json?.errors) {
      console.error("[billing] Partner API errors:", JSON.stringify(json.errors));
      return undefined;
    }
    return json?.data?.activeSubscription ? PLAN_PRO : PLAN_FREE;
  } catch (err) {
    console.error("[billing] Partner API request failed:", err);
    return undefined;
  }
}

/**
 * Reconcile Shop.plan on app load. Reads the welcome-redirect `plan_handle` (instant
 * upgrade) and the authoritative Partner API, then persists the result so the worker
 * sees it. Returns the resolved plan. Safe to call when Partner creds are absent —
 * it degrades to redirect-only and never downgrades on an unknown result.
 */
export async function refreshShopPlan(
  admin: AdminLike,
  shopDomain: string,
  request: Request,
): Promise<string> {
  const shopRow = await prisma.shop.upsert({
    where: { shopDomain },
    update: {},
    create: { shopDomain, fromName: shopDomain.replace(/\.myshopify\.com$/, "") },
  });

  // (a) A plan_handle on the redirect means the merchant just approved a plan.
  const planHandle = new URL(request.url).searchParams.get("plan_handle");
  let plan: string = shopRow.plan;
  if (planHandle) plan = PLAN_PRO;

  // (b) Authoritative reconcile. Don't let a lagging API downgrade a fresh subscriber
  // in the same request (only apply "free" when this isn't a welcome redirect).
  if (PARTNER_TOKEN && PARTNER_ORG && APP_ID) {
    const shopGid = await shopGlobalId(admin);
    if (shopGid) {
      const authoritative = await partnerPlan(shopGid);
      if (authoritative === PLAN_PRO) plan = PLAN_PRO;
      else if (authoritative === PLAN_FREE && !planHandle) plan = PLAN_FREE;
    }
  }

  if (plan !== shopRow.plan) {
    await prisma.shop.update({ where: { id: shopRow.id }, data: { plan } });
  }
  return plan;
}
