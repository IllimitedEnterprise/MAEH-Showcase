#!/usr/bin/env node
/* Verify the frozen data.
 *
 *   node scripts/verify.mjs [--all]          every day, the chain, the derived files, privacy (default)
 *   node scripts/verify.mjs --day DATE       one day only
 *   node scripts/verify.mjs --ci --base SHA  also check that since SHA only additions were made under results/
 *   node scripts/verify.mjs --history        scan every blob that was ever committed (the pre-publish gate)
 *
 * Exit code 0 when clean, 1 when anything is wrong. Anyone can run this on a fresh clone: it needs
 * nothing but Node and the repository. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ciDiff, scanHistory, verifyEverything } from "./lib/audit.mjs";
import { createGit } from "./lib/git.mjs";
import { loadContext } from "./lib/pipeline.mjs";
import { assertNodeVersion, resolveGit } from "./lib/runtime.mjs";
import { checkDay, errorsOf, formatFinding, readDayFiles } from "./lib/verify.mjs";
import { dayPath } from "./lib/seal.mjs";

assertNodeVersion(22);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);

let ctx = null;
try {
  ctx = loadContext(root);
} catch (error) {
  console.log(`note: settings could not be loaded (${error.message}); derived files will not be re-checked`);
}

const findings = [];
let summary = "";

if (value("--day")) {
  const date = value("--day");
  const files = readDayFiles(dayPath(root, date));
  findings.push(...checkDay({ date, files, rules: ctx?.rulesFor((JSON.parse(files.get("day.json")).rules)) ?? null }));
  summary = `day ${date}`;
} else if (!has("--history") || has("--all")) {
  const result = verifyEverything({ root, ctx });
  findings.push(...result.findings);
  summary = `${result.days} day(s)`;
}

if (has("--ci") || has("--history")) {
  const git = createGit({ gitPath: resolveGit().path, cwd: root });
  if (has("--ci")) {
    const diff = ciDiff({ git, base: value("--base") });
    findings.push(...diff.findings);
    summary += diff.skipped ? ", no base to diff against" : `, ${diff.changes ?? 0} change(s) under results since the base`;
  }
  if (has("--history")) {
    const history = scanHistory({ git });
    findings.push(...history.findings);
    summary += `${summary ? ", " : ""}${history.blobs} blob(s) in history scanned`;
  }
}

const errors = errorsOf(findings);
for (const finding of findings) console.log(formatFinding(finding));
console.log(errors.length ? `FAILED: ${errors.length} problem(s) (${summary})` : `OK: ${summary}`);
process.exitCode = errors.length ? 1 : 0;
