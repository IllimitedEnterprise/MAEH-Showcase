/* The numbers of a day, defined exactly as the harness defines them.
 *
 * A "close" is one fully closed position: { key, ticket, symbol, side, cents, r, closeSec,
 * openSec }. Money is integer cents. Parity with the harness's performance section is
 * pinned by test/parity.test.mjs against goldens the harness itself generated:
 *   - win rate = wins / (wins + losses), breakevens excluded, one decimal
 *   - profit factor = round(grossWin / grossLoss, 2), null when nothing was lost
 *   - streaks run in close order and a breakeven resets the run
 *   - drawdown is trade-level on cumulative net, the peak starting at zero
 *   - R is only counted for closes that carry one, never zero-filled */

import { bucketIndex, hourBuckets } from "./time.mjs";
import { fromCents } from "./canonical.mjs";

const round = (value, places) => Number(value.toFixed(places));

function compareCloses(a, b) {
  if (a.closeSec !== b.closeSec) return a.closeSec - b.closeSec;
  if (Number.isFinite(a.ticket) && Number.isFinite(b.ticket)) return a.ticket - b.ticket;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/* Close order, deterministic even when two closes share a second. */
export const orderCloses = (closes) => [...closes].sort(compareCloses);

export function stats(closes) {
  const rows = orderCloses(closes).filter((close) => Number.isInteger(close.cents));
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let net = 0;
  let best = null;
  let worst = null;
  let streakType = null;
  let streakCount = 0;
  let maxWins = 0;
  let maxLosses = 0;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let rCount = 0;
  let rValues = [];
  const pairs = new Map();

  for (const close of rows) {
    net += close.cents;
    const type = close.cents > 0 ? "win" : close.cents < 0 ? "loss" : null;
    if (type === "win") {
      wins += 1;
      grossWin += close.cents;
      if (!best || close.cents > best.cents) best = close;
    } else if (type === "loss") {
      losses += 1;
      grossLoss += -close.cents;
      if (!worst || close.cents < worst.cents) worst = close;
    } else {
      breakevens += 1;
    }
    if (!type) {
      streakType = null;
      streakCount = 0;
    } else {
      streakCount = type === streakType ? streakCount + 1 : 1;
      streakType = type;
      if (type === "win") maxWins = Math.max(maxWins, streakCount);
      else maxLosses = Math.max(maxLosses, streakCount);
    }
    cumulative += close.cents;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    if (Number.isFinite(close.r)) {
      rCount += 1;
      rValues.push(close.r);
    }
    const symbol = close.symbol ?? "?";
    const pair = pairs.get(symbol) ?? { symbol, n: 0, netCents: 0 };
    pair.n += 1;
    pair.netCents += close.cents;
    pairs.set(symbol, pair);
  }

  const decided = wins + losses;
  return {
    n: rows.length,
    wins, losses, breakevens, decided,
    winRatePct: decided ? round((wins / decided) * 100, 1) : null,
    grossWinCents: grossWin,
    grossLossCents: grossLoss,
    netCents: net,
    profitFactor: grossLoss > 0 ? round(fromCents(grossWin) / fromCents(grossLoss), 2) : null,
    streaks: { maxWins, maxLosses },
    maxDrawdownCents: maxDrawdown,
    r: rCount ? { count: rCount, sum: round(rValues.reduce((sum, value) => sum + value, 0), 3) } : null,
    best, worst,
    pairs: [...pairs.values()].sort((a, b) => b.n - a.n || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)),
  };
}

/* Trade counts per local entry hour, for the closes of one day. The day is the CLOSE day, so a
 * trade opened the evening before sits in `earlier`, and one with no entry record in `unknown`;
 * trades still open are not in the day yet. Σ buckets + earlier + unknown = total, always. */
export function hoursRecord(closes, window) {
  const labels = hourBuckets(window);
  const counts = new Array(labels.length).fill(0);
  let earlier = 0;
  let unknown = 0;
  for (const close of closes) {
    const opened = close.openSec;
    if (!Number.isFinite(opened) || opened <= 0) unknown += 1;
    else if (opened < window.startSec) earlier += 1;
    else {
      const index = bucketIndex(window, opened);
      if (index < 0) unknown += 1;
      else counts[index] += 1;
    }
  }
  return {
    basis: "entry-of-closes",
    zone: window.zone,
    buckets: labels.map((label, index) => ({ h: label.h, off: label.off, n: counts[index] })),
    earlier, unknown, total: closes.length,
  };
}

/* Balance moved between two captures versus the closes booked in between. A deposit, a credit
 * or a close the read missed shows up as a gap. `ok` is null when there is nothing to compare. */
export function captureDelta({ previousCents, balanceCents, closesCents, toleranceCents = 1 }) {
  if (!Number.isInteger(previousCents) || !Number.isInteger(balanceCents)) return { ok: null, gapCents: null };
  const gapCents = balanceCents - previousCents - closesCents;
  return { ok: Math.abs(gapCents) <= toleranceCents, gapCents };
}

/* The backfill gate: funding plus every close the ledger holds must equal the balance now. A
 * difference means the terminal forgot closes before the ledger began, so earlier days cannot
 * be called complete. */
export function backfillGate({ fundingCents, ledgerNetCents, balanceCents, toleranceCents = 1 }) {
  if (![fundingCents, ledgerNetCents, balanceCents].every(Number.isInteger)) return { ok: null, gapCents: null };
  const gapCents = balanceCents - (fundingCents + ledgerNetCents);
  return { ok: Math.abs(gapCents) <= toleranceCents, gapCents };
}
