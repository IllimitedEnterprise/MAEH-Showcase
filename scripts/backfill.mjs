#!/usr/bin/env node
/* Build the first stretch of history from the harness's close ledgers. See scripts/lib/backfill.mjs.
 *
 *   node scripts/backfill.mjs --init-accounts [--force]   write config/accounts.json from what the harness lists
 *   node scripts/backfill.mjs [--report]                   survey every account and show the plan; changes nothing
 *   node scripts/backfill.mjs --yes [--from D] [--to D]    freeze the days, oldest first, as `backfilled`
 *
 * It needs the harness running (the live balance is what the gate checks) and does not commit or push. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backfill, initAccounts, planDates, reportLines, survey } from "./lib/backfill.mjs";
import { verifyEverything } from "./lib/audit.mjs";
import { createHarness } from "./lib/harness.mjs";
import { loadContext } from "./lib/pipeline.mjs";
import { assertNodeVersion } from "./lib/runtime.mjs";
import { formatFinding } from "./lib/verify.mjs";

assertNodeVersion(22);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (has(flag) ? args[args.indexOf(flag) + 1] : null);
const nowSec = Math.floor(Date.now() / 1000);

try {
  const ctx = loadContext(root, process.env, { withAccounts: !has("--init-accounts") });
  const client = createHarness({ baseUrl: ctx.priv.harnessUrl, timeoutMs: 120_000, retryDelaysMs: [5_000, 20_000] });

  if (has("--init-accounts")) {
    const accounts = await initAccounts({ ctx, client, nowSec, force: has("--force") });
    console.log(`wrote config/accounts.json with ${accounts.length} account(s):`);
    for (const account of accounts) console.log(`  ${account.key}  funded ${account.fundedDate}`);
  } else {
    const { surveyed } = await survey({ ctx, client, labels: ctx.allow.map((account) => account.label), nowSec, log: console.log });
    for (const line of reportLines({ surveyed, zone: ctx.season.zone })) console.log(line);
    const dates = planDates({ ctx, from: value("--from"), to: value("--to"), nowSec });
    console.log(`\nplan: ${dates.length} day(s) to freeze${dates.length ? ` (${dates[0]} to ${dates.at(-1)})` : ""}`);
    const unverified = surveyed.filter((account) => account.gate.ok !== true);
    if (unverified.length) console.log(`${unverified.length} account(s) did not pass the gate; their days will be published as unverified and left out of every crown`);

    if (has("--yes")) {
      const result = await backfill({ ctx, surveyed, dates, nowSec, log: console.log });
      const check = verifyEverything({ root, ctx });
      for (const finding of check.errors) console.log(formatFinding(finding));
      console.log(`${result.sealed.length} day(s) frozen; ${check.errors.length ? `FAILED: ${check.errors.length} problem(s)` : "everything verifies"}`);
      process.exitCode = check.errors.length ? 1 : 0;
    } else {
      console.log("report only: pass --yes to freeze these days");
    }
  }
} catch (error) {
  console.log(`backfill stopped: ${error.message}`);
  process.exitCode = 1;
}
