#!/usr/bin/env node
/* Assemble the GitHub Pages artifact into _site/ (never committed).
 *
 *   node scripts/build-site.mjs [--out _site] [--commit SHA] [--verified]
 *
 * --verified records that the full verification passed before this build; the workflow passes it
 * only after `verify --all` succeeded. The build id is the commit's first seven characters, so the
 * same commit always produces the same URLs. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./lib/site.mjs";
import { createGit } from "./lib/git.mjs";
import { assertNodeVersion, resolveGit } from "./lib/runtime.mjs";

assertNodeVersion(22);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag, fallback = null) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);

let commit = value("--commit") ?? process.env.GITHUB_SHA ?? null;
if (!commit) {
  try {
    commit = createGit({ gitPath: resolveGit().path, cwd: root }).headSha();
  } catch {
    commit = "local";
  }
}
if (!/^[0-9a-f]{7,40}$|^local$/.test(commit)) {
  console.error(`not a commit id: ${commit}`);
  process.exit(2);
}

const index = JSON.parse(readFileSync(resolve(root, "results", "index.json"), "utf8"));
const build = commit === "local" ? "local" : commit.slice(0, 7);
const result = buildSite({
  root,
  out: resolve(root, value("--out", "_site")),
  build,
  commit,
  verified: args.includes("--verified"),
  tip: index.tip,
});
console.log(`built ${result.files} files (${(result.bytes / 1024).toFixed(0)} KB of site and data) into ${result.out}`);
console.log(`build ${build}, tip #${index.tip.seq} ${index.tip.date}${args.includes("--verified") ? ", verified" : ""}`);
