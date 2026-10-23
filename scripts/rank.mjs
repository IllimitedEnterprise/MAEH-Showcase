#!/usr/bin/env node
/* Rebuild the derived standings (stars/, results/index.json, results/series.json) from the frozen days.
 *
 *   node scripts/rank.mjs            rebuild and write
 *   node scripts/rank.mjs --check    rebuild in memory and compare with the disk; write nothing
 *
 * `--check` is what CI runs: a derived file that differs from a rebuild was edited by hand or is out of date. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDerived, checkDerived, loadModel } from "./lib/derived.mjs";
import { loadContext, rebuildDerived } from "./lib/pipeline.mjs";
import { assertNodeVersion } from "./lib/runtime.mjs";
import { formatFinding } from "./lib/verify.mjs";

assertNodeVersion(22);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = loadContext(root);

if (process.argv.includes("--check")) {
  const model = loadModel(root, { seasonStart: ctx.season.seasonStart, zone: ctx.season.zone, allow: ctx.allow, rulesFor: ctx.rulesFor });
  const findings = checkDerived(root, buildDerived(model));
  for (const finding of findings) console.log(formatFinding(finding));
  console.log(findings.length ? `FAILED: ${findings.length} derived file(s) differ from a rebuild` : `OK: ${model.days.length} day(s); derived files match a rebuild`);
  process.exitCode = findings.length ? 1 : 0;
} else {
  const result = rebuildDerived(ctx);
  console.log(`rebuilt ${result.written} file(s) from ${result.model.days.length} day(s)${result.removed.length ? `; removed ${result.removed.length} stale` : ""}`);
}
