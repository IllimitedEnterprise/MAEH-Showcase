import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromCents, toCents } from "../scripts/lib/canonical.mjs";
import { closeFromApi, withResult } from "../scripts/lib/ingest.mjs";
import { stats } from "../scripts/lib/metrics.mjs";

const goldens = JSON.parse(readFileSync(new URL("./fixtures/harness-goldens.json", import.meta.url), "utf8"));

test("the goldens are present and cover the shapes that matter", () => {
  const names = goldens.cases.map((entry) => entry.name);
  for (const wanted of ["empty", "mixed-60", "all-wins", "all-losses", "breakeven-runs", "drawdown-shape",
    "stress-400", "decimals-stress", "with-intents", "one-missing-result"])
    assert.ok(names.includes(wanted), `missing case ${wanted}`);
});

for (const golden of goldens.cases) {
  test(`parity with the harness: ${golden.name}`, () => {
    const closes = withResult(golden.expected.trades.map(closeFromApi));
    const mine = stats(closes);
    const theirs = golden.expected.statistics;

    assert.equal(mine.wins, theirs.wins, "wins");
    assert.equal(mine.losses, theirs.losses, "losses");
    assert.equal(mine.breakevens, theirs.breakevens, "breakevens");
    assert.equal(mine.winRatePct, theirs.winRatePct, "win rate");
    assert.equal(fromCents(mine.grossWinCents), theirs.grossWin, "gross win");
    assert.equal(fromCents(mine.grossLossCents), theirs.grossLoss, "gross loss");
    assert.equal(mine.profitFactor, theirs.profitFactor, "profit factor");
    assert.equal(mine.streaks.maxWins, theirs.streaks.maxWins, "longest winning run");
    assert.equal(mine.streaks.maxLosses, theirs.streaks.maxLosses, "longest losing run");
    assert.equal(fromCents(mine.netCents), golden.expected.moneyTotal, "net");
    assert.equal(mine.maxDrawdownCents, toCents(golden.expected.maxDrawdown), "trade-level drawdown");

    if (theirs.biggestWin) {
      assert.equal(fromCents(mine.best.cents), theirs.biggestWin.netMoney, "biggest win");
      assert.equal(mine.best.symbol, theirs.biggestWin.symbol, "biggest win symbol");
    } else assert.equal(mine.best, null);
    if (theirs.biggestLoss) {
      assert.equal(fromCents(mine.worst.cents), theirs.biggestLoss.netMoney, "biggest loss");
      assert.equal(mine.worst.symbol, theirs.biggestLoss.symbol, "biggest loss symbol");
    } else assert.equal(mine.worst, null);

    assert.equal(mine.r?.count ?? 0, golden.expected.rCount, "R count");
    assert.equal(mine.r?.sum ?? 0, golden.expected.rTotal, "R total");

    // The harness counts a row with no recorded result in its pair tally; we leave such rows
    // out of every figure (and flag the day), so only compare pairs where none exist.
    if (golden.name !== "one-missing-result") {
      assert.deepEqual(mine.pairs.map(({ symbol, n }) => ({ symbol, count: n })),
        theirs.pairs.map(({ symbol, count }) => ({ symbol, count })), "pairs");
    }
  });
}

test("the missing-result case really is counted differently, and on purpose", () => {
  const golden = goldens.cases.find((entry) => entry.name === "one-missing-result");
  const all = golden.expected.trades.map(closeFromApi);
  assert.equal(all.length, 4);
  assert.equal(withResult(all).length, 3);
});
