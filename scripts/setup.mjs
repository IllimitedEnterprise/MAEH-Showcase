#!/usr/bin/env node
/* Set this checkout up to run the nightly freeze.
 *
 *   node scripts/setup.mjs                      show what would change (changes nothing)
 *   node scripts/setup.mjs --yes                apply it
 *   node scripts/setup.mjs --yes --name "Name" --email "id+user@users.noreply.github.com"
 *   node scripts/setup.mjs --no-credentials     leave the push credentials alone
 *
 * Only this repository's own git config is touched. Contributors who only read or test the code do
 * not need this; it is for the machine that commits and pushes each night. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGit } from "./lib/git.mjs";
import { assertNodeVersion, resolveGh, resolveGit } from "./lib/runtime.mjs";
import { NOREPLY, applySettings, describePlan, makeHooksExecutable, planSettings, wantedSettings } from "./lib/setup.mjs";

assertNodeVersion(22);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (has(flag) ? args[args.indexOf(flag) + 1] : null);

const name = value("--name");
const email = value("--email");
if (email && !NOREPLY.test(email)) {
  console.error(`That address is not a GitHub noreply address (id+user@users.noreply.github.com). A private address would be published in every commit.`);
  process.exit(2);
}

const git = createGit({ gitPath: resolveGit().path, cwd: root });
if (!git.isRepo()) {
  console.error("This folder is not a git repository.");
  process.exit(2);
}

let ghPath = null;
if (!has("--no-credentials")) {
  try {
    ghPath = resolveGh().path;
  } catch {
    console.log("note: the GitHub CLI was not found, so push credentials are left to git's own helper.");
  }
}

const plan = planSettings(git, wantedSettings({ ghPath, name, email }));
console.log("MAEH Showcase setup (this checkout only; nothing global is changed)\n");
console.log(describePlan(plan).join("\n"));
for (const key of ["user.name", "user.email"]) {
  const now = git.config(key);
  if (!plan.some((entry) => entry.key === key)) console.log(`\n  ${key} is ${now ? `"${now}"` : "NOT SET: pass --name and --email, or set it, before the first nightly commit"}`);
}

if (!has("--yes")) {
  console.log(`\n${plan.some((entry) => entry.change) ? "Run again with --yes to apply this." : "Nothing to change."}`);
  process.exit(0);
}

const changed = applySettings(git, plan);
const hooks = makeHooksExecutable(root);
console.log(`\napplied ${changed.length} setting(s)${hooks.length ? `, hooks made executable: ${hooks.join(", ")}` : ""}.`);
const after = planSettings(git, wantedSettings({ ghPath, name, email })).filter((entry) => entry.change);
if (after.length) {
  console.error(`could not set: ${after.map((entry) => entry.key).join(", ")}`);
  process.exit(1);
}
