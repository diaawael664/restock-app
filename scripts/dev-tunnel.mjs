/**
 * One-command dev: starts the ngrok tunnel on the fixed domain, then `shopify app
 * dev` bound to it on port 3000. The App Proxy URL is already deployed to this domain,
 * so there's nothing to reconfigure between sessions — just run `npm run dev:tunnel`.
 *
 * Finds ngrok even when it isn't on PATH (winget install location), falling back to a
 * bare `ngrok` on PATH. Ctrl+C stops both processes.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DOMAIN = "dreadlock-emphatic-rush.ngrok-free.dev";
const PORT = 3000;
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");

function resolveNgrok() {
  const links = path.join(LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ngrok.exe");
  if (existsSync(links)) return links;
  const pkgs = path.join(LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  try {
    const dir = readdirSync(pkgs).find((d) => d.startsWith("Ngrok.Ngrok"));
    if (dir) {
      const exe = path.join(pkgs, dir, "ngrok.exe");
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* fall through */
  }
  return "ngrok"; // rely on PATH
}

const ngrok = resolveNgrok();
const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

function start(label, cmd, args, opts = {}) {
  console.log(`[dev-tunnel] starting ${label}`);
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  child.on("exit", (c) => {
    console.log(`[dev-tunnel] ${label} exited (${c}) — stopping the other process`);
    shutdown(c ?? 0);
  });
  child.on("error", (e) => {
    console.error(`[dev-tunnel] ${label} failed to start:`, e.message);
    shutdown(1);
  });
  children.push(child);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[dev-tunnel] ngrok   = ${ngrok}`);
console.log(`[dev-tunnel] tunnel  = https://${DOMAIN} -> localhost:${PORT}`);

// 1) The tunnel (direct exe — no shell needed).
start("ngrok", ngrok, ["http", String(PORT), `--domain=${DOMAIN}`, "--log=stdout"]);

// 2) Shopify dev on :3000 behind the tunnel. Use `npx shopify` (not the bare `dev`
// script) so it resolves even when the Shopify CLI isn't on PATH. shell:true so npx
// resolves on Windows.
setTimeout(() => {
  start(
    "shopify app dev",
    "npx",
    ["shopify", "app", "dev", "--config", "restock-alerts", `--tunnel-url=https://${DOMAIN}:${PORT}`],
    { shell: true },
  );
}, 2500);
