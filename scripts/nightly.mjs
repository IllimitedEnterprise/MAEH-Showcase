#!/usr/bin/env node
/* The nightly job. See scripts/lib/nightly.mjs for what it does and what its exit codes mean.
 *
 *   node scripts/nightly.mjs                       freeze every due day, rank, verify, commit, push
 *   node scripts/nightly.mjs --status              look at the state; change nothing
 *   node scripts/nightly.mjs --dry-run             read and render, write nothing
 *   node scripts/nightly.mjs --retry-push          push commits that were made but not pushed
 *   node scripts/nightly.mjs --accept-partial DATE --reason "text"
 *                                                  seal a day although an account could not be read
 *   node scripts/nightly.mjs --no-push --no-wait   skip the push / the settle wait */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNightly } from "./lib/nightly.mjs";
import { assertNodeVersion } from "./lib/runtime.mjs";

function parse(args) {
  const argv = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--status") argv.status = true;
    else if (flag === "--dry-run") argv.dryRun = true;
    else if (flag === "--retry-push") argv.retryPush = true;
    else if (flag === "--no-push") argv.noPush = true;
    else if (flag === "--no-wait") argv.noWait = true;
    else if (flag === "--hermes") argv.hermes = true;
    else if (flag === "--accept-partial") argv.acceptPartial = args[++index];
    else if (flag === "--reason") argv.reason = args[++index];
    else throw new Error(`unknown option ${flag}`);
  }
  if (argv.acceptPartial && !argv.reason) throw new Error("--accept-partial needs --reason");
  return argv;
}

try {
  assertNodeVersion(22);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await runNightly({ root, argv: parse(process.argv.slice(2)) });
  process.stdout.write(result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  process.stdout.write(`ATTENTION ${String(error.message).replace(/[^A-Za-z0-9 ._:;+/(),=-]/g, "?").slice(0, 200)}\n`);
  process.stdout.write(`${JSON.stringify({ wakeAgent: true, outcome: "error", frozen: [], pushed: false, attention: ["the job could not start"] })}\n`);
  process.exitCode = 5;
}
