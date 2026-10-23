/* The pieces every command shares: the loaded settings, reading a day's accounts, freezing it.
 *
 * `loadContext` joins the public settings (config/) with the private ones (the state folder).
 * `gatherDay` reads every published account for one local day, using the live harness when it
 * is there and the close ledger when it is not, and `freezeDay` renders and seals the result. */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { captureAccount } from "./capture.mjs";
import { loadAccounts, loadPrivate, loadRules, loadSeason } from "./config.mjs";
import { buildDerived, loadModel, writeDerived } from "./derived.mjs";
import { ledgerDir } from "./ledger.mjs";
import { renderDay } from "./render.mjs";
import { stateDir as defaultStateDir } from "./runtime.mjs";
import { dayPath, sealDay } from "./seal.mjs";
import { dayWindow } from "./time.mjs";

export function loadContext(root, env = process.env, { withAccounts = true } = {}) {
  const season = loadSeason(root);
  const allow = withAccounts ? loadAccounts(root) : [];
  const rulesFor = (version) => {
    try { return loadRules(root, version); } catch { return null; }
  };
  const rules = rulesFor(season.rules);
  if (!rules) throw new Error(`config: the rules file for ${season.rules} was not found`);
  const stateDir = defaultStateDir(env);
  return { root, season, allow, rules, rulesFor, stateDir, priv: loadPrivate(stateDir, env) };
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}

/* Read every published account for one day.
 *   roster     the harness's own list (from a live preflight), or null when it is unreachable
 *   accountsMap  label -> { id } remembered from an earlier read, so the ledger can still be found
 *   previous   { key: { sec, balanceCents } } the last capture of each account */
export async function gatherDay({ ctx, date, nowSec, client = null, roster = null, accountsMap = {}, previous = {}, log = () => {}, sleep, deltaRetryMs }) {
  const window = dayWindow(date, ctx.season.zone);
  const byLabel = new Map((roster?.accounts ?? []).map((account) => [account.label, account]));
  const captures = [];
  for (const allow of ctx.allow) {
    if (date < allow.fundedDate) {
      captures.push({ allow, capture: null, gate: null });
      continue;
    }
    const rosterEntry = byLabel.get(allow.label) ?? null;
    const id = rosterEntry?.id ?? accountsMap[allow.label]?.id ?? null;
    const liveDir = ctx.priv.harnessVarDir && id ? ledgerDir(ctx.priv.harnessVarDir, id) : null;
    const capture = await captureAccount({
      account: allow, window, nowSec, client, rosterEntry, liveDir, previousCapture: previous[allow.key] ?? null, log,
      ...(sleep ? { sleep } : {}), ...(deltaRetryMs !== undefined ? { deltaRetryMs } : {}),
    });
    captures.push({ allow, capture, gate: null });
  }
  const unusable = captures.filter((entry) => entry.capture && !entry.capture.usable).map((entry) => entry.allow.key);
  return { window, captures, unusable };
}

export function freezeDay({ ctx, date, kind, captures, nowSec }) {
  const window = dayWindow(date, ctx.season.zone);
  const rendered = renderDay({ date, window, kind, accounts: captures, rules: ctx.rules });
  const sealed = sealDay({ root: ctx.root, date, rendered, kind, capturedAtSec: nowSec, zone: ctx.season.zone, window, rules: ctx.rules });
  return { rendered, sealed };
}

export const capturesFile = (ctx) => join(ctx.stateDir, "captures.json");
export const lastRunFile = (ctx) => join(ctx.stateDir, "last-run.json");

/* Rebuild stars/ and the catalogue from the frozen days. Built twice and compared first: a
 * derived file that changes between two builds of the same days would be a bug, caught here. */
export function rebuildDerived(ctx) {
  const model = loadModel(ctx.root, { seasonStart: ctx.season.seasonStart, zone: ctx.season.zone, allow: ctx.allow, rulesFor: ctx.rulesFor });
  const first = buildDerived(model);
  const second = buildDerived(model);
  for (const [path, text] of first) {
    if (second.get(path) !== text) throw new Error(`derived output is not deterministic: ${path}`);
  }
  const result = writeDerived(ctx.root, first);
  return { model, files: first, ...result };
}

/* Move freshly sealed day folders out of the repository, for a night that failed verification. */
export function quarantineDays(ctx, dates) {
  const moved = [];
  for (const date of dates) {
    const from = dayPath(ctx.root, date);
    if (!existsSync(from)) continue;
    const to = join(ctx.stateDir, "quarantine", `${date}-${Date.now()}`);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
    moved.push(to);
  }
  return moved;
}
