/* Building the first stretch of history from the harness's own close ledgers.
 *
 * A live read only reaches back a few days, but the ledger holds every close the harness has
 * seen, so the days before the nightly job existed are rebuilt from it, each marked
 * `backfilled`. The ledger is only trustworthy if it is complete, and the terminal's deal cache
 * is known to forget closes, so before freezing anything each account is put through a gate:
 *
 *      funding  +  the net of every close in the ledger   =   the balance right now
 *
 * An account that passes has a complete history. One that does not has its days published but
 * badged `unverified`, shown with the size of the gap, and left out of every crown.
 *
 * The live read made here is also what proves the ledger is current: reading the terminal banks
 * whatever it holds into the ledger, so the ledger is read afterwards. */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCents } from "./canonical.mjs";
import { captureAccount } from "./capture.mjs";
import { backfillGate } from "./metrics.mjs";
import { HarnessError, preflight } from "./harness.mjs";
import { ledgerDir, readAnchor, readLedger } from "./ledger.mjs";
import { freezeDay, rebuildDerived } from "./pipeline.mjs";
import { addDays, dayWindow, lastSettledDate, localDate } from "./time.mjs";
import { listFrozen } from "./verify.mjs";

const safeKey = (label) => String(label).trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+|\.+$/g, "").slice(0, 48);
const fmt = (cents) => (cents === null || cents === undefined ? "-" : (cents / 100).toFixed(2));

/* Read one account: its ledger, funding record and live balance. */
async function readAccount({ ctx, client, entry, nowSec, sleep }) {
  const live = ctx.priv.harnessVarDir ? ledgerDir(ctx.priv.harnessVarDir, entry.id) : null;
  if (!live) throw new Error("the harness var folder is not configured (MAEH_HARNESS_VAR or the private config)");
  const progress = await client.progress(entry.id, 1); // proves the ledger is current, and gives the balance
  let ledger;
  try {
    ledger = await readLedger(live, { sleep });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    ledger = { rows: [], badLines: 0, torn: false, mtimeSec: nowSec };
  }
  const anchor = readAnchor(live);
  const nets = ledger.rows.filter((row) => Number.isFinite(row?.netProfit)).map((row) => toCents(row.netProfit));
  const closes = ledger.rows.filter((row) => Number.isFinite(row?.closedAt)).map((row) => row.closedAt).sort((a, b) => a - b);
  return {
    id: entry.id, label: entry.label, ledger: { ...ledger, mtimeSec: nowSec }, anchor, progress,
    rows: ledger.rows.length, ledgerNetCents: nets.reduce((a, b) => a + b, 0),
    firstCloseSec: closes[0] ?? null, lastCloseSec: closes.at(-1) ?? null,
    gate: backfillGate({ fundingCents: anchor?.fundingCents ?? null, ledgerNetCents: nets.reduce((a, b) => a + b, 0), balanceCents: progress.balanceCents }),
  };
}

export async function survey({ ctx, client, labels, nowSec, sleep, log = () => {} }) {
  const roster = await preflight({ client, now: () => nowSec * 1000, sleep: sleep ?? (async () => {}), maxWaitMs: 0, pollMs: 1, log });
  const byLabel = new Map(roster.accounts.map((account) => [account.label, account]));
  const surveyed = [];
  for (const label of labels) {
    const entry = byLabel.get(label);
    if (!entry) throw new Error(`the harness does not list an account called ${label}`);
    surveyed.push(await readAccount({ ctx, client, entry, nowSec, sleep }));
  }
  return { roster, surveyed };
}

export function reportLines({ surveyed, zone }) {
  const lines = ["account              rows  first close  last close   funded      funding   ledger net  balance     gap       gate"];
  for (const account of surveyed) {
    const day = (sec) => (sec === null ? "-" : localDate(sec, zone));
    lines.push([
      account.label.padEnd(20), String(account.rows).padStart(4), day(account.firstCloseSec).padStart(12), day(account.lastCloseSec).padStart(12),
      (account.anchor?.fundingAtSec ? localDate(account.anchor.fundingAtSec, zone) : "-").padStart(11),
      fmt(account.anchor?.fundingCents).padStart(10), fmt(account.ledgerNetCents).padStart(11), fmt(account.progress.balanceCents).padStart(10),
      fmt(account.gate.gapCents).padStart(9), account.gate.ok === true ? "ok" : account.gate.ok === false ? "UNVERIFIED" : "unknown",
    ].join(" "));
  }
  return lines;
}

/* config/accounts.json from what the harness lists: the published list, in desk order. */
export async function initAccounts({ ctx, client, nowSec, write = true, force = false }) {
  const roster = await preflight({ client, now: () => nowSec * 1000, sleep: async () => {}, maxWaitMs: 0, pollMs: 1 });
  const accounts = [];
  for (const entry of roster.accounts.filter((account) => account.active)) {
    const live = ctx.priv.harnessVarDir ? ledgerDir(ctx.priv.harnessVarDir, entry.id) : null;
    const anchor = live ? readAnchor(live) : null;
    if (!anchor?.fundingAtSec) throw new Error(`no funding record for ${entry.label}; it cannot be listed yet`);
    accounts.push({ label: entry.label, key: safeKey(entry.label), fundedDate: localDate(anchor.fundingAtSec, ctx.season.zone) });
  }
  const file = join(ctx.root, "config", "accounts.json");
  if (write) {
    if (existsSync(file) && !force) throw new Error("config/accounts.json already exists; pass --force to replace it");
    writeFileSync(file, `${JSON.stringify({ schema: 1, accounts }, null, 2)}\n`, "utf8");
  }
  return accounts;
}

/* Dates to freeze: from `from` (default the season start) to `to` (default the last settled day), not already frozen. */
export function planDates({ ctx, from, to, nowSec }) {
  const frozen = new Set(listFrozen(ctx.root).filter((day) => day.text !== null).map((day) => day.date));
  const last = to ?? lastSettledDate(nowSec, ctx.season.zone, ctx.season.settleMinutes);
  const dates = [];
  for (let date = from ?? ctx.season.seasonStart; date <= last; date = addDays(date, 1)) if (!frozen.has(date)) dates.push(date);
  return dates;
}

/* Freeze the given dates, oldest first, as backfilled days. */
export async function backfill({ ctx, surveyed, dates, nowSec, log = () => {} }) {
  const sealed = [];
  for (const date of dates) {
    const window = dayWindow(date, ctx.season.zone);
    const captures = [];
    for (const allow of ctx.allow) {
      if (date < allow.fundedDate) { captures.push({ allow, capture: null, gate: null }); continue; }
      const account = surveyed.find((entry) => entry.label === allow.label);
      if (!account) throw new Error(`${allow.label} was not surveyed`);
      const capture = await captureAccount({
        account: allow, window, nowSec, client: null, rosterEntry: null, liveDir: "pre-read", previousCapture: null,
        ledgerExists: () => true, ledgerReader: async () => account.ledger, anchorReader: () => account.anchor, log,
      });
      captures.push({ allow, capture, gate: account.gate });
    }
    const result = freezeDay({ ctx, date, kind: "backfilled", captures, nowSec });
    sealed.push({ date, status: result.rendered.status, seq: result.sealed.seq });
    log(`froze ${date} (${result.rendered.status})`);
  }
  const derived = sealed.length ? rebuildDerived(ctx) : null;
  return { sealed, derived };
}

export { HarnessError };
