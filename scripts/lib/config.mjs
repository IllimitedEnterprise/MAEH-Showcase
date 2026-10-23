/* Settings, in two places on purpose.
 *
 *   config/*.json in the repository: public, reviewed, versioned. The season (zone, start
 *   date, timings), the list of accounts that may be published, and the ranking rules.
 *
 *   <state dir>/config.json, outside the repository: private to this machine. Where the harness
 *   listens and where its files live. Nothing machine-specific is ever committed. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKDAY_NAMES, parseDate, resolveZone } from "./time.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const fail = (message) => { throw new Error(`config: ${message}`); };

export function loadSeason(root) {
  const season = read(join(root, "config", "season.json"));
  const zone = resolveZone(season.zone);
  parseDate(season.seasonStart);
  for (const field of ["settleMinutes", "quietWaitMinutes"]) {
    if (!Number.isInteger(season[field]) || season[field] < 0 || season[field] > 240) fail(`${field} must be 0 to 240`);
  }
  const days = season.healthWakeDays ?? [];
  if (!Array.isArray(days) || days.some((day) => !WEEKDAY_NAMES.includes(day))) fail(`healthWakeDays must be names from ${WEEKDAY_NAMES.join(", ")}`);
  if (typeof season.rules !== "string" || !season.rules) fail("season.rules must name the rules version new days are sealed under");
  return { ...season, zone, healthWakeDays: days };
}

const KEY = /^[A-Za-z0-9._-]{1,48}$/;

/* The accounts that may be published, in desk order. A label the harness reports that is not
 * in this list is never published; it is raised as something to look at. */
export function loadAccounts(root) {
  const doc = read(join(root, "config", "accounts.json"));
  if (!Array.isArray(doc.accounts) || doc.accounts.length === 0) fail("accounts.json has no accounts");
  const seen = new Set();
  return doc.accounts.map((entry, order) => {
    if (typeof entry.label !== "string" || !entry.label) fail("an account has no label");
    if (!KEY.test(entry.key)) fail(`account key "${entry.key}" is not folder-safe`);
    if (seen.has(entry.key)) fail(`account key "${entry.key}" is used twice`);
    seen.add(entry.key);
    parseDate(entry.fundedDate);
    return { label: entry.label, key: entry.key, fundedDate: entry.fundedDate, order };
  });
}

export function loadRules(root, version = "v1") {
  const rules = read(join(root, "config", `rules.${version}.json`));
  if (rules.version !== version) fail(`rules.${version}.json declares version ${rules.version}`);
  return rules;
}

/* Machine-local settings. Environment variables win over the file. */
export function loadPrivate(stateDir, env = process.env) {
  const file = join(stateDir, "config.json");
  const stored = existsSync(file) ? read(file) : {};
  return {
    harnessUrl: env.MAEH_HARNESS_URL || stored.harnessUrl || "http://127.0.0.1:8790",
    harnessVarDir: env.MAEH_HARNESS_VAR || stored.harnessVarDir || null,
  };
}
