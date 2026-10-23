#!/usr/bin/env node
/* Preview the dashboard locally, exactly as GitHub Pages will serve it.
 *
 *   node scripts/serve.mjs [--port 4173] [--base /MAEH-Showcase/]
 *
 * Listens on 127.0.0.1 only. A browser blocks module scripts opened from a file:// address, which
 * is why the site needs a server at all. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSiteServer } from "./lib/site.mjs";
import { createGit } from "./lib/git.mjs";
import { assertNodeVersion, resolveGit } from "./lib/runtime.mjs";

assertNodeVersion(22);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const port = Number(value("--port", "4173"));
const base = value("--base", "/MAEH-Showcase/");

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`not a port: ${value("--port")}`);
  process.exit(2);
}

/* The preview reports the real commit, so what a visitor would see on the Integrity page (a forty
 * character hash) is what the preview shows too. */
let commit = "0".repeat(40);
try {
  commit = createGit({ gitPath: resolveGit().path, cwd: root }).headSha() || commit;
} catch {
  /* not a git checkout, or no git: the placeholder is fine for a preview */
}

const server = createSiteServer({ root, base, commit });
server.listen(port, "127.0.0.1", () => {
  const { port: actual } = server.address();
  console.log(`MAEH Showcase preview: http://127.0.0.1:${actual}${base.endsWith("/") ? base : `${base}/`}`);
  console.log("Press Ctrl+C to stop.");
});
