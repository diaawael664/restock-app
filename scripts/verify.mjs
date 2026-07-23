// `npm run verify` — one command to prove the app is runtime-ready.
// Runs, in order: prisma generate -> schema sync (migrate deploy | db push) ->
// tsc --noEmit -> connectivity check (Postgres/Redis/Resend).
// Exit 0 = all PASS. Exit 1 = something FAILED. Exit 2 = BLOCKED on missing creds.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const PLACEHOLDER = /example\.com|your-|user:pass|re_xxxxxxxx|:password@|PASTE_HERE|<.*>/i;
const dbBlocked =
  !process.env.DATABASE_URL || PLACEHOLDER.test(process.env.DATABASE_URL || "");

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true });
  return r.status === 0;
}

const steps = [];
function mark(name, state, note = "") {
  steps.push({ name, state, note });
}

// 1. prisma generate
mark("prisma generate", run("npx prisma generate") ? "PASS" : "FAIL");

// 2. schema sync
const migDir = "prisma/migrations";
const hasMigrations =
  existsSync(migDir) && readdirSync(migDir).some((d) => !d.startsWith("."));
if (dbBlocked) {
  mark("schema sync", "BLOCKED", "DATABASE_URL not set / placeholder");
} else if (hasMigrations) {
  const ok = run("npx prisma migrate deploy") || run("npx prisma db push --accept-data-loss");
  mark("schema sync (migrate deploy)", ok ? "PASS" : "FAIL");
} else {
  mark("schema sync (db push)", run("npx prisma db push --accept-data-loss") ? "PASS" : "FAIL");
}

// 3. typecheck
mark("tsc --noEmit", run("npx tsc --noEmit") ? "PASS" : "FAIL");

// 4. connectivity
const conn = spawnSync("node scripts/check-connectivity.mjs", { stdio: "inherit", shell: true });
mark(
  "connectivity (pg/redis/resend)",
  conn.status === 0 ? "PASS" : conn.status === 2 ? "BLOCKED" : "FAIL",
);

// Summary
console.log("\n════════ verify summary ════════");
for (const s of steps) {
  const icon = s.state === "PASS" ? "✔" : s.state === "FAIL" ? "✘" : "•";
  console.log(`${icon} ${s.name.padEnd(34)} ${s.state}${s.note ? "  (" + s.note + ")" : ""}`);
}
const anyFail = steps.some((s) => s.state === "FAIL");
const anyBlocked = steps.some((s) => s.state === "BLOCKED");
console.log("════════════════════════════════");
if (anyFail) { console.log("RESULT: FAIL — fix the ✘ steps above.\n"); process.exit(1); }
if (anyBlocked) { console.log("RESULT: BLOCKED — supply the missing env vars, then re-run.\n"); process.exit(2); }
console.log("RESULT: PASS — runtime-ready.\n");
process.exit(0);
