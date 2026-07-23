# Restock Alerts — Runbook

Everything you need to take this from code to a running dev install. The code for
**Day 1 (plumbing)** and most of Days 2–4 is already scaffolded; this is the operator's checklist.

## What's already built

| Piece | Where |
|---|---|
| Postgres schema (Shop / Subscriber / Alert + Session) | `prisma/schema.prisma` |
| Instant-sync webhook (⭐) | `app/routes/webhooks.inventory_levels.update.tsx` |
| BullMQ queue | `app/queue.server.ts` |
| Persistent worker (match + send) | `worker.ts` → `npm run worker` |
| Subscribe endpoint (App Proxy) | `app/routes/proxy.subscribe.tsx` |
| One-click unsubscribe page | `app/routes/unsubscribe.tsx` |
| Branded emails (confirmation + alert) | `app/email.server.ts` |
| GDPR/compliance webhooks | `app/routes/webhooks.compliance.tsx` |
| Uninstall cleanup | `app/routes/webhooks.app.uninstalled.tsx` |
| Storefront widget (theme app extension) | `extensions/restock-widget/` |
| Billing (flat $14.99 Pro, Shopify App Pricing) | plan set in Partner Dashboard; status synced by `app/billing.server.ts` |

## Prerequisites (accounts to create — ~20 min)

1. **Shopify Partner account** + a **development store** — https://partners.shopify.com
2. **Postgres** — Neon / Supabase / Railway free tier → grab the connection string.
3. **Redis** — Upstash free tier → grab the `rediss://` URL.
4. **Resend** — API key + a **verified sending domain** (add DKIM/SPF DNS records). Deliverability is a wedge; don't send from an unverified domain.

## First run (local dev)

```bash
cd restock-app
cp .env.example .env          # fill in DATABASE_URL, REDIS_URL, RESEND_API_KEY, RESEND_FROM_ADDRESS
npm install
npm run verify                # generate client, push schema, typecheck, ping pg/redis/resend
npm run test:acceptance       # prove the restock path end-to-end (needs pg + redis)

# Terminal 1 — the Shopify app (OAuth, admin, webhooks, proxy). Opens the tunnel + install link.
npm run dev

# Terminal 2 — the persistent worker (the thing that actually sends alerts).
npm run worker
```

> For production, cut a real migration once you have a DB: `npx prisma migrate dev --name init`
> (the repo ships no migrations; `npm run verify` bootstraps tables with `prisma db push`).

`npm run dev` (Shopify CLI) will prompt you to log in, pick/create the Partner app, and
link `shopify.app.toml`. It injects `SHOPIFY_API_KEY` / `SHOPIFY_APP_URL` automatically —
you do **not** put those in `.env` by hand for dev.

> ⚠️ Two processes. The web app enqueues jobs; the **worker** sends emails. If the worker
> isn't running, subscribers are captured but no alerts go out.

## Verify & automated tests

| Command | What it does | Needs |
|---|---|---|
| `npm run verify` | prisma generate → schema push → `tsc --noEmit` → connectivity ping (Postgres/Redis/Resend), printing PASS/FAIL/BLOCKED per service. Exit 0 all-pass, 1 fail, 2 blocked-on-creds. | reads `.env` |
| `npm run test:acceptance` | Seeds a subscriber → fires a **validly-signed** `inventory_levels/update` (0→5) at the real route → asserts 200 + enqueue → runs the **real worker subprocess** → asserts subscriber notified + Alert row + alert email (dry-run). Also asserts invalid HMAC → 401 with no enqueue. | live Postgres + Redis |
| `npx tsx scripts/prove-hmac.ts` | Proves invalid-HMAC→401 and valid-HMAC→accepted **without any infra** (HMAC is checked before the DB). | nothing |

`test:acceptance` sets `EMAIL_DRY_RUN=1`, so it never sends real mail — it records the
outbound alert and asserts its recipient/subject. `verify` separately pings the real Resend key.

## Account setup checklist (do in one sitting)

Do these in order; the first one can gate your App Store submission, so start it now.

1. **Shopify Partner account → request Protected Customer Data (FIRST).**
   https://partners.shopify.com → create the app → **API access** → request **Level 1**
   protected customer data (you collect shopper emails) and complete the data-handling
   questionnaire. Approval can take time and **gates submission** — file it before you build more.
2. **Dev store.** Partner dashboard → **Stores → Add store → Development store**.
3. **Postgres.** Create a DB at https://neon.tech (or Supabase/Railway) → copy the
   connection string into `DATABASE_URL`.
4. **Redis.** Create a database at https://upstash.com → copy the **`rediss://` TLS URL**
   into `REDIS_URL`.
5. **Resend.** https://resend.com → add + verify your sending domain (DKIM/SPF DNS records) →
   create an API key → set `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` (an address on that domain).
6. **Link the app + run.** `npm run dev` → log in → pick/create the Partner app (writes
   `client_id` into `shopify.app.toml`). Then `npm run verify` should go all-green.
7. **Install + turn on the widget.** Open the CLI install link on your dev store → theme
   editor → enable the **Restock alerts** app embed.

## Prove the differentiator (Day 3 acceptance test — manual, in a real store)

1. Install the app on your dev store from the CLI link.
2. In the theme editor, turn on the **Restock alerts** app embed.
3. Open a product, set one variant's inventory to **0** (so the storefront shows sold out).
4. On the storefront PDP, click **Notify me** → enter an email → confirm you get the
   confirmation email.
5. In Shopify admin, raise that variant's inventory **0 → 5**.
6. Watch the worker log (`[restock] … sent=1`) and the alert email land — should be **seconds**.

If that loop is fast and the email looks great, you have a product. If not, fix that before anything else.

## Compliance (start Day 1, don't leave to the end)

- **Protected Customer Data:** In the Partner Dashboard → your app → *API access*, request
  **Level 1** protected customer data (you collect shopper emails) and complete the
  data-handling questionnaire. This can gate your submission — start it now.
- The GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are wired
  in `webhooks.compliance.tsx`. `shop/redact` hard-deletes the shop (cascades to subscribers/alerts).

## Deploy (persistent worker required)

Use a host that keeps a Node process alive (Fly.io / Railway / Render) — **not** pure
serverless, or the BullMQ worker dies.

- **Web:** `npm run build` then `npm run start` (after `prisma migrate deploy`).
- **Worker:** a *second* process/service running `npm run worker:start`, same env vars.
- Set all env vars from `.env.example` on both. Set `SHOPIFY_APP_URL` to the deployed URL and
  update `application_url` / `app_proxy.url` / `auth.redirect_urls` in `shopify.app.toml`, then
  `npm run deploy`.

## Known Day-1 gaps (by design — later in the 7-day plan)

- **Admin dashboard (Day 5):** pending count, alerts sent, recovered revenue, settings
  (threshold/logo/color/from-name), subscriber list. Not built yet — `app/routes/app._index.tsx`
  is still the template default.
- **Recovered-revenue attribution:** `Alert.recoveredOrderId` exists but nothing writes it yet
  (needs an `orders/create` webhook matching `?ref=restock`).
- **Webhook noise:** `inventory_levels/update` fires on *every* inventory change. The worker's
  indexed lookup filters fast, but at scale add a Redis pre-filter (a set of inventoryItemIds
  that actually have pending subscribers) before touching Postgres.
