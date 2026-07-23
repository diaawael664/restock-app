# GO-LIVE

Your path from empty accounts to a green, running app. Pasting credentials into
`.env` is the only manual step — everything else is a command.

---

## Step 1 — Create accounts (in this order)

> **Do #1 first.** Protected Customer Data approval can gate App Store submission,
> and it's out of your control timeline-wise, so file it before anything else.

1. **Shopify Partner + Protected Customer Data (FIRST).**
   https://partners.shopify.com → create the app → **API access** → request
   **Level 1 protected customer data** (you collect shopper emails) → complete the
   data-handling questionnaire. *Unblocks: submission later. Start it now.*
2. **Dev store.** Partners → **Stores → Add store → Development store**.
   *Unblocks: installing/testing the app.*
3. **Neon Postgres.** https://neon.tech → new project → copy the Prisma/pooled
   connection string → paste into `DATABASE_URL`. *Unblocks: schema + acceptance test.*
4. **Upstash Redis.** https://upstash.com → new database → copy the **`rediss://`**
   URL → paste into `REDIS_URL`. *Unblocks: the queue + acceptance test.*
5. **Resend.** https://resend.com → **verify a sending domain** (add DKIM/SPF DNS
   records) → create an API key → paste `RESEND_API_KEY` and set
   `RESEND_FROM_ADDRESS` to an address on that domain. *Unblocks: real emails.*

Fill each value in `.env` (replace `PASTE_HERE`). Order to fill:
**DATABASE_URL → REDIS_URL → RESEND_API_KEY → RESEND_FROM_ADDRESS.**
Until all three infra strings are in, `npm run doctor` and `npm run verify` exit **2 (BLOCKED)**
and name exactly which var is missing — that's expected, not an error.

---

## Step 2 — Bring it up (once `.env` is filled)

### 2a. Pre-flight connectivity — catch a bad string instantly
```
npm run doctor
```
Expected once all creds are good:
```
Connectivity check
──────────────────
✔ Postgres  PASS     SELECT 1 ok
✔ Redis     PASS     PING -> PONG
✔ Resend    PASS     API key valid (domains.list ok)
```
If one is wrong you get a single `✘ … FAIL <reason>` line for that service — not a stack trace.

### 2b. Link the Shopify app (fills the CLI-managed vars automatically)
```
npm run dev
```
Log in when prompted, pick/create the Partner app. This writes `client_id` into
`shopify.app.toml` and injects `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` /
`SHOPIFY_APP_URL` at runtime — you do **not** hand-edit those in `.env`.
Leave it running; open the printed install link on your dev store.

### 2c. Full verify — the runtime-readiness gate
```
npm run verify
```
Expected (all green):
```
════════ verify summary ════════
✔ prisma generate                    PASS
✔ schema sync (db push)              PASS
✔ tsc --noEmit                       PASS
✔ connectivity (pg/redis/resend)     PASS
════════════════════════════════
RESULT: PASS — runtime-ready.
```

### 2d. Acceptance test — proves the whole restock path
```
npm run test:acceptance
```
Expected (all green):
```
✔ seed: shop + pending subscriber created
✔ invalid HMAC -> 401, no enqueue
✔ valid HMAC -> 200 (fast)
✔ job enqueued to Redis
✔ worker processed: subscriber notified + Alert row
✔ alert email sent with correct recipient + subject
RESULT: PASS — core restock path works end to end.
```
This never sends real mail (it runs in `EMAIL_DRY_RUN`); `verify` already proved the
real Resend key works.

### 2e. Run the worker (second terminal, for real dev use)
```
npm run worker
```
The web app enqueues; the **worker** sends. Both must run for live alerts.

---

## Step 3 — Before production: convert the bootstrap to a real migration

`npm run verify` bootstraps tables with **`prisma db push`**, which is **dev-only** —
it syncs the schema with no migration history. Before you deploy, cut a real,
versioned migration once (with `DATABASE_URL` set):

```
npx prisma migrate dev --name init
```

This creates `prisma/migrations/…_init/` and switches you to a migration-based
workflow. In production, deploys then run **`prisma migrate deploy`** (already the
`setup` script) — **never** `db push` against a production database.

---

## One-glance status

| Command | Needs | Green means |
|---|---|---|
| `npm run doctor` | `.env` infra strings | pg/redis/resend reachable |
| `npm run dev` | Partner login | app linked + install link |
| `npm run verify` | `.env` + login | runtime-ready |
| `npm run test:acceptance` | pg + redis | restock path proven |
| `npm run worker` | `.env` | alerts actually send |
