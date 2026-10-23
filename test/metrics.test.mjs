import test from "node:test";
import assert from "node:assert/strict";
import { backfillGate, captureDelta, hoursRecord, orderCloses, stats } from "../scripts/lib/metrics.mjs";
import { dayWindow } from "../scripts/lib/time.mjs";

const close = (cents, closeSec, extra = {}) => ({
  key: `${closeSec}:${cents}`, ticket: closeSec, symbol: "EURUSD", side: "long", cents, r: null,
  closeSec, openSec: closeSec - 600, ...extra,
});

test("empty input gives zeros and nulls, not NaN", () => {
  const result = stats([]);
  assert.equal(result.n, 0);
  assert.equal(result.winRatePct, null);
  assert.equal(result.profitFactor, null);
  assert.equal(result.maxDrawdownCents, 0);
  assert.equal(result.r, null);
  assert.deepEqual(result.pairs, []);
});

test("zero is data: a breakeven counts, ends a streak, and stays out of the win rate", () => {
  const result = stats([close(500, 1), close(500, 2), close(0, 3), close(500, 4), close(-100, 5)]);
  assert.equal(result.breakevens, 1);
  assert.equal(result.n, 5);
  assert.equal(result.winRatePct, 75);
  assert.deepEqual(result.streaks, { maxWins: 2, maxLosses: 1 });
});

test("no losses: profit factor is null so the page can say infinity, not zero", () => {
  const result = stats([close(100, 1), close(200, 2)]);
  assert.equal(result.profitFactor, null);
  assert.equal(result.grossLossCents, 0);
  assert.equal(result.winRatePct, 100);
});

test("drawdown is trade-level on the cumulative result, the peak starting at zero", () => {
  const result = stats([close(1000, 1), close(-500, 2), close(-700, 3), close(300, 4), close(-100, 5)]);
  // cumulative: 1000, 500, -200, 100, 0 ; peak 1000 ; worst 1000 - (-200) = 1200
  assert.equal(result.maxDrawdownCents, 1200);
  assert.equal(stats([close(-300, 1)]).maxDrawdownCents, 300);
});

test("two closes in the same second keep a stable order by ticket", () => {
  const a = close(100, 10, { ticket: 7, key: "7@10" });
  const b = close(-50, 10, { ticket: 3, key: "3@10" });
  assert.deepEqual(orderCloses([a, b]).map((entry) => entry.ticket), [3, 7]);
  assert.deepEqual(orderCloses([b, a]).map((entry) => entry.ticket), [3, 7]);
});

test("pairs count and net per symbol, most traded first, ties alphabetical", () => {
  const result = stats([
    close(100, 1, { symbol: "GBPJPY" }), close(-50, 2, { symbol: "EURUSD" }),
    close(20, 3, { symbol: "EURUSD" }), close(10, 4, { symbol: "AUDUSD" }),
  ]);
  assert.deepEqual(result.pairs, [
    { symbol: "EURUSD", n: 2, netCents: -30 },
    { symbol: "AUDUSD", n: 1, netCents: 10 },
    { symbol: "GBPJPY", n: 1, netCents: 100 },
  ]);
});

test("R is summed only over closes that carry one", () => {
  const result = stats([close(100, 1, { r: 1.5 }), close(-50, 2), close(-25, 3, { r: -0.5 })]);
  assert.deepEqual(result.r, { count: 2, sum: 1 });
});

test("hour buckets: entry hour of the closes, with earlier and unknown kept apart", () => {
  const window = dayWindow("2026-10-25", "Europe/Berlin");
  const start = window.startSec;
  const closes = [
    close(1, start + 100, { openSec: start - 3600 }),          // opened the evening before
    close(1, start + 100, { openSec: null }),                  // no entry record
    close(1, start + 100, { openSec: start }),                 // 00:00 local, bucket 0
    close(1, start + 100, { openSec: start + 2 * 3600 + 1800 }), // 02:30 CEST, bucket 2
    close(1, start + 100, { openSec: start + 3 * 3600 + 1800 }), // 02:30 CET, bucket 3
    close(1, start + 100, { openSec: start + 20 * 3600 }),
  ];
  const record = hoursRecord(closes, window);
  assert.equal(record.basis, "entry-of-closes");
  assert.equal(record.buckets.length, 25);
  assert.equal(record.earlier, 1);
  assert.equal(record.unknown, 1);
  assert.equal(record.total, 6);
  assert.equal(record.buckets[0].n, 1);
  assert.equal(record.buckets[2].n, 1);
  assert.equal(record.buckets[3].n, 1);
  assert.deepEqual([record.buckets[2].h, record.buckets[2].off, record.buckets[3].off], ["02:00", "+02:00", "+01:00"]);
  const sum = record.buckets.reduce((total, bucket) => total + bucket.n, 0) + record.earlier + record.unknown;
  assert.equal(sum, record.total);
});

test("an entry time after the window closes is unknown, never silently bucketed", () => {
  const window = dayWindow("2026-10-22", "Europe/Berlin");
  const record = hoursRecord([close(1, window.startSec + 5, { openSec: window.endSec + 10 })], window);
  assert.equal(record.unknown, 1);
  assert.equal(record.buckets.reduce((total, bucket) => total + bucket.n, 0), 0);
});

test("capture delta explains the balance by the closes, and shows the gap when it cannot", () => {
  assert.deepEqual(captureDelta({ previousCents: 5_000_000, balanceCents: 5_010_050, closesCents: 10_050 }),
    { ok: true, gapCents: 0 });
  assert.deepEqual(captureDelta({ previousCents: 5_000_000, balanceCents: 5_110_050, closesCents: 10_050 }),
    { ok: false, gapCents: 100_000 });
  assert.deepEqual(captureDelta({ previousCents: null, balanceCents: 5_000_000, closesCents: 0 }),
    { ok: null, gapCents: null });
});

test("the backfill gate: funding plus every ledger close must equal the balance", () => {
  assert.deepEqual(backfillGate({ fundingCents: 5_000_000, ledgerNetCents: 12_345, balanceCents: 5_012_345 }),
    { ok: true, gapCents: 0 });
  assert.deepEqual(backfillGate({ fundingCents: 5_000_000, ledgerNetCents: 8_363, balanceCents: 5_055_970 }),
    { ok: false, gapCents: 47_607 });
  assert.equal(backfillGate({ fundingCents: null, ledgerNetCents: 0, balanceCents: 1 }).ok, null);
});
