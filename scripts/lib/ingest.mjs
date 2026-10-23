/* From raw harness rows to "closes".
 *
 * Both sources are read through explicit picks: a field that is not named here never reaches
 * the rest of the program, so a new column in the harness cannot leak into a published file.
 *
 *   API rows    GET /api/v1/account/progress -> trades[]   (carry R and the self-test flag)
 *   ledger rows var/accounts/<id>/live/broker-closes.ndjson (full history, no R)
 *
 * Identity is `ticket@round(closedAt)`, as in the harness: a ticket closed in parts is several
 * closes, and the same close seen in both sources is one. */

import { toCents } from "./canonical.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export const closeKey = (ticket, closeSec) => `${finite(ticket) ? ticket : "?"}@${Math.round(closeSec)}`;

function sideOf(direction, type) {
  const word = String(direction ?? "").trim().toUpperCase();
  if (word === "LONG") return "long";
  if (word === "SHORT") return "short";
  const code = String(type ?? "").trim().toUpperCase();
  if (code.includes("BUY") || code === "0") return "long";
  if (code.includes("SELL") || code === "1") return "short";
  return "unknown";
}

/* A row of progress.trades[] (already in the harness's own shape). */
export function closeFromApi(row) {
  if (!row || !finite(row.at)) return null;
  return {
    key: closeKey(row.ticket, row.at),
    ticket: finite(row.ticket) ? row.ticket : null,
    symbol: typeof row.symbol === "string" ? row.symbol.slice(0, 32) : null,
    side: sideOf(row.direction, row.type),
    cents: finite(row.netMoney) ? toCents(row.netMoney) : null,
    r: finite(row.r) ? row.r : null,
    closeSec: Math.floor(row.at),
    openSec: finite(row.openedAt) ? Math.floor(row.openedAt) : null,
    selftest: row.selftest === true,
    source: "api",
  };
}

/* A line of broker-closes.ndjson. */
export function closeFromLedger(row) {
  if (!row || !finite(row.closedAt)) return null;
  return {
    key: closeKey(row.ticket, row.closedAt),
    ticket: finite(row.ticket) ? row.ticket : null,
    symbol: typeof row.symbol === "string" ? row.symbol.slice(0, 32) : null,
    side: sideOf(row.direction, row.type),
    cents: finite(row.netProfit) ? toCents(row.netProfit) : null,
    r: null,
    closeSec: Math.floor(row.closedAt),
    openSec: finite(row.openedAt) ? Math.floor(row.openedAt) : null,
    selftest: false,
    source: "ledger",
  };
}

/* One source's rows to a keyed map, counting rows that repeat a key. */
function keyed(rows, convert) {
  const map = new Map();
  let duplicates = 0;
  for (const row of rows ?? []) {
    const close = convert(row);
    if (!close) continue;
    if (map.has(close.key)) duplicates += 1;
    else map.set(close.key, close);
  }
  return { map, duplicates };
}

/* The union of both sources. Where a close is in both, the API row wins (it carries R). The
 * counts say how far the two agree: `onlyLedger` should be zero when the API read is whole. */
export function mergeCloses({ apiRows = null, ledgerRows = null }) {
  const api = apiRows ? keyed(apiRows, closeFromApi) : null;
  const ledger = ledgerRows ? keyed(ledgerRows, closeFromLedger) : null;
  const merged = new Map();
  let both = 0;
  let onlyApi = 0;
  let onlyLedger = 0;
  for (const [key, close] of api?.map ?? []) {
    if (ledger?.map.has(key)) {
      both += 1;
      merged.set(key, { ...close, source: "both" });
    } else {
      if (ledger) onlyApi += 1;
      merged.set(key, close);
    }
  }
  for (const [key, close] of ledger?.map ?? []) {
    if (merged.has(key)) continue;
    if (api) onlyLedger += 1;
    merged.set(key, close);
  }
  const closes = [...merged.values()];
  return {
    closes,
    witness: { both, onlyApi, onlyLedger, compared: Boolean(api && ledger) },
    anomalies: {
      duplicateRows: (api?.duplicates ?? 0) + (ledger?.duplicates ?? 0),
      nullNet: closes.filter((close) => close.cents === null).length,
      unknownSide: closes.filter((close) => close.side === "unknown").length,
    },
  };
}

export const inWindow = (closes, window) =>
  closes.filter((close) => close.closeSec >= window.startSec && close.closeSec < window.endSec);

/* Closes with a recorded result: the ones every statistic is computed over. */
export const withResult = (closes) => closes.filter((close) => Number.isInteger(close.cents));
