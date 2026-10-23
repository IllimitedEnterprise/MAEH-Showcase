/* Reading one account's closes for one local day, and deciding whether that read is complete.
 *
 * Two sources, and the rules for trusting them:
 *
 *   live read   GET progress. Exact and current, but it only holds the newest 500 closes and a
 *               short window, so it can only describe a recent day.
 *   ledger      the harness's own append-only copy of every close it has seen. Complete, but
 *               only as fresh as the last time the harness read the terminal: a ledger is
 *               trusted for a day when a live read succeeded in this same run (that read banks
 *               what it sees), or when the file was written after the day ended.
 *
 * A day is `usable` when at least one source is complete for it. Problems are recorded as
 * codes: a `partial` problem makes the account-day partial, a `note` is context, and `blocking`
 * means there was no complete source at all. */

import { existsSync } from "node:fs";
import { HarnessError } from "./harness.mjs";
import { inWindow, mergeCloses } from "./ingest.mjs";
import { readAnchor, readLedger } from "./ledger.mjs";
import { captureDelta } from "./metrics.mjs";

const MAX_API_DAYS = 3;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Days of live history a read must ask for so that it reaches the start of the window. */
export const neededDays = (window, nowSec) => Math.max(1, Math.ceil((nowSec - window.startSec + 3600) / 86_400));

const sumCents = (closes) => closes.reduce((total, close) => total + (Number.isInteger(close.cents) ? close.cents : 0), 0);

export async function captureAccount({
  account, window, nowSec,
  client = null, rosterEntry = null, liveDir = null, previousCapture = null,
  log = () => {}, sleep = wait, deltaRetryMs = 20_000,
  ledgerReader = readLedger, anchorReader = readAnchor, ledgerExists = existsSync,
}) {
  const problems = [];
  const note = (code, extra = {}) => problems.push({ code, severity: "note", ...extra });
  const partial = (code, extra = {}) => problems.push({ code, severity: "partial", ...extra });

  /* 1. the live read */
  const needed = neededDays(window, nowSec);
  const reaches = needed <= MAX_API_DAYS;
  let api = null;
  if (client && rosterEntry) {
    if (!rosterEntry.active) {
      note("api-skipped");
    } else {
      try {
        api = await client.progress(rosterEntry.id, Math.min(needed, MAX_API_DAYS));
      } catch (error) {
        note("api-unavailable", { detail: error instanceof HarnessError ? (error.code ?? `HTTP${error.status ?? ""}`) : "ERROR" });
        log(`live read failed for ${account.key}`);
      }
    }
  }

  /* 2. the ledger */
  let ledger = null;
  if (liveDir && ledgerExists(liveDir)) {
    try {
      ledger = await ledgerReader(liveDir);
    } catch {
      note("ledger-unreadable");
    }
  }
  const anchor = liveDir ? anchorReader(liveDir) : null;
  const ledgerFresh = Boolean(ledger) && (Boolean(api) || ledger.mtimeSec >= window.endSec);
  if (ledger && !ledgerFresh) note("ledger-stale");
  if (ledger?.torn) partial("ledger-torn");

  /* 3. which rows describe the day */
  const apiRows = api && reaches ? api.rows : null;
  const apiComplete = apiRows !== null && !api.truncated && (api.rangeFromSec == null || api.rangeFromSec <= window.startSec);
  const ledgerRows = ledgerFresh ? ledger.rows : null;
  const usable = apiComplete || ledgerFresh;

  const dayApi = apiRows ? apiRows.filter((row) => row && row.at >= window.startSec && row.at < window.endSec) : null;
  const dayLedger = ledgerRows ? ledgerRows.filter((row) => row && row.closedAt >= window.startSec && row.closedAt < window.endSec) : null;
  const merged = mergeCloses({ apiRows: dayApi, ledgerRows: dayLedger });
  const closes = inWindow(merged.closes, window);

  if (!usable) {
    if (api && reaches && api.truncated) problems.push({ code: "api-truncated", severity: "blocking" });
    else problems.push({ code: "no-complete-source", severity: "blocking" });
  } else if (apiRows === null && ledgerRows) {
    note("ledger-source");
  }
  if (merged.witness.compared && merged.witness.onlyLedger > 0)
    note("terminal-forgot", { n: merged.witness.onlyLedger, attention: true });
  if (merged.anomalies.nullNet > 0) partial("null-result", { n: merged.anomalies.nullNet });
  if (merged.anomalies.duplicateRows > 0) note("duplicate-rows", { n: merged.anomalies.duplicateRows });

  let source = null;
  if (dayApi && dayLedger) source = "both";
  else if (dayApi) source = "api";
  else if (dayLedger) source = "ledger";

  /* 4. the balance chain: the balance must have moved by exactly the closes booked since the
   *    previous capture. A deposit, or a close the read missed, shows up as a gap. */
  let delta = { ok: null, gapCents: null };
  const balanceChain = async (live) => {
    if (!previousCapture || !Number.isInteger(live.balanceCents)) return { ok: null, gapCents: null };
    const from = previousCapture.sec;
    const apiCovers = live.rangeFromSec != null && live.rangeFromSec <= from;
    const apiSince = apiCovers ? live.rows.filter((row) => row && row.at > from && row.at <= nowSec) : null;
    const ledgerSince = ledgerRows ? ledgerRows.filter((row) => row && row.closedAt > from && row.closedAt <= nowSec) : null;
    if (!apiSince && !ledgerSince) return { ok: null, gapCents: null };
    const since = mergeCloses({ apiRows: apiSince, ledgerRows: ledgerSince });
    return captureDelta({ previousCents: previousCapture.balanceCents, balanceCents: live.balanceCents, closesCents: sumCents(since.closes) });
  };
  if (api) {
    delta = await balanceChain(api);
    if (delta.ok === false && client && rosterEntry) {
      // A close can land between the harness's balance read and its history read. Look once more.
      await sleep(deltaRetryMs);
      try {
        const again = await client.progress(rosterEntry.id, Math.min(needed, MAX_API_DAYS));
        const second = await balanceChain(again);
        if (second.ok !== null) { api = again; delta = second; }
      } catch { /* keep the first answer */ }
    }
    if (delta.ok === false) partial("balance-gap", { amountCents: delta.gapCents });
  }

  return {
    key: account.key,
    label: account.label,
    usable,
    source,
    closes,
    problems,
    witness: merged.witness,
    currency: api?.currency ?? anchor?.currency ?? null,
    fundingCents: Number.isInteger(anchor?.fundingCents) ? anchor.fundingCents : (api?.fundingCents ?? null),
    balanceCents: api?.balanceCents ?? null,
    delta,
    captureRecord: api && Number.isInteger(api.balanceCents) ? { sec: nowSec, balanceCents: api.balanceCents } : null,
    ledger: ledger ? { mtimeSec: ledger.mtimeSec, torn: ledger.torn, rows: ledger.rows.length } : null,
    apiOk: Boolean(api),
  };
}
