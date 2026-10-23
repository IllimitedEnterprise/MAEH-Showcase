import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stats } from "../scripts/lib/metrics.mjs";
import { compareRanked, disqualifications, evaluatePeriod, scorePeriod } from "../scripts/lib/score.mjs";

const rules = JSON.parse(readFileSync(new URL("../config/rules.v1.json", import.meta.url), "utf8"));
const DAY = rules.periods.day;
const FUNDING = 5_000_000; // EUR 50,000.00

const closes = (list) => list.map((cents, index) => ({
  key: `k${index}`, ticket: index, symbol: "EURUSD", side: "long", cents, r: null, closeSec: index, openSec: null,
}));
const scoreOf = (list, params = DAY) => scorePeriod({ stats: stats(closes(list)), fundingCents: FUNDING, params, rules });

test("the rules file is versioned and complete", () => {
  assert.equal(rules.version, "v1");
  for (const kind of ["day", "week", "month"]) {
    for (const field of ["retHalf", "ddZero", "k", "minCloses", "minActiveDays"]) assert.ok(rules.periods[kind][field] > 0, `${kind}.${field}`);
  }
  assert.ok(Math.abs(Object.values(rules.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9, "weights sum to one");
});

test("three wins worth +1.5% score what the formula says by hand: 59.23", () => {
  // m_ret .75, m_pf 1 (no losses), m_dd 1, m_win 1 -> raw 90 ; credibility 3/13
  const result = scoreOf([25_000, 25_000, 25_000]);
  assert.equal(result.score, 59.23);
  assert.deepEqual(result.comp, { ret: 0.75, pf: 1, dd: 1, win: 1, cred: 0.231 });
  assert.equal(result.retPct, 1.5);
  assert.equal(result.ddPct, 0);
});

test("credibility: a lucky three-close day cannot outrank a solid sixty-close day", () => {
  const lucky = scoreOf([25_000, 25_000, 25_000]).score;
  const solid = [];
  for (let index = 0; index < 25; index += 1) solid.push(6_000, -3_600); // 25 winners and 25 losers, interleaved
  for (let index = 0; index < 10; index += 1) solid.push(6_000);
  const result = scoreOf(solid);
  assert.equal(solid.length, 60);
  assert.ok(result.score > lucky + 10, `solid ${result.score} vs lucky ${lucky}`);
});

test("a result of zero earns half a mark for return; the full mark at +retHalf, none at -retHalf", () => {
  assert.equal(scoreOf([100, -100, 100, -100]).comp.ret, 0.5);
  const plus = scorePeriod({ stats: stats(closes([DAY.retHalf * 50_000])), fundingCents: FUNDING, params: DAY, rules });
  assert.equal(plus.comp.ret, 1);
  const minus = scorePeriod({ stats: stats(closes([-DAY.retHalf * 50_000])), fundingCents: FUNDING, params: DAY, rules });
  assert.equal(minus.comp.ret, 0);
  const beyond = scorePeriod({ stats: stats(closes([DAY.retHalf * 500_000])), fundingCents: FUNDING, params: DAY, rules });
  assert.equal(beyond.comp.ret, 1, "clamped, not unbounded");
});

test("profit factor marks: 1 earns half, 4 earns full, nothing lost earns full, nothing won or lost earns half, all lost earns none", () => {
  assert.equal(scoreOf([200, -200, 200, -200]).comp.pf, 0.5);
  assert.equal(scoreOf([400, -100]).comp.pf, 1);
  assert.equal(scoreOf([400, 100]).comp.pf, 1);
  assert.equal(scoreOf([0, 0, 0]).comp.pf, 0.5);
  assert.equal(scoreOf([-100, -200]).comp.pf, 0);
});

test("win rate: breakevens are not decided; with nothing decided the mark is half", () => {
  assert.equal(scoreOf([0, 0, 0]).comp.win, 0.5);
  assert.equal(scoreOf([100, 100, 100, -100, -100, -100]).comp.win, 0.5, "50% -> (50-30)/40");
  assert.equal(scoreOf([100, 100, 100, -100, -100, 0, 0]).comp.win, 0.75, "60% of the decided (zeros ignored) -> (60-30)/40");
  assert.equal(scoreOf([100, 100, 100, -100, 0, 0]).comp.win, 1, "75% is past the 70% that earns the full mark");
});

test("drawdown: none earns the full mark, ddZero percent of funding earns none", () => {
  assert.equal(scoreOf([100, 100]).comp.dd, 1);
  const deep = scoreOf([-DAY.ddZero * 50_000, 1]);
  assert.equal(deep.comp.dd, 0);
  assert.equal(deep.ddPct, DAY.ddZero);
});

test("nothing to score gives nulls, not NaN", () => {
  assert.deepEqual(scoreOf([]), { score: null, comp: null, retPct: null, ddPct: null });
  const unfunded = scorePeriod({ stats: stats(closes([100])), fundingCents: null, params: DAY, rules });
  assert.equal(unfunded.score, null);
});

test("longer periods ask for more evidence before trusting a result", () => {
  const list = Array.from({ length: 10 }, (_, index) => (index % 3 === 0 ? -1_000 : 2_000));
  const day = scoreOf(list, rules.periods.day).score;
  const month = scoreOf(list, rules.periods.month).score;
  assert.ok(Math.abs(day - 50) > Math.abs(month - 50), `day ${day} is further from 50 than month ${month}`);
});

const row = (key, list, over = {}) => ({
  key, label: key, fundedDate: "2026-10-01", fundingCents: FUNDING, stats: stats(closes(list)),
  activeDays: 1, statuses: ["ok"], ...over,
});

test("disqualifications say plainly why an account cannot be ranked", () => {
  const params = DAY;
  assert.deepEqual(disqualifications({ row: row("a", [1, 2, 3]), params, periodStart: "2026-10-22" }), []);
  assert.match(disqualifications({ row: row("a", [1, 2]), params, periodStart: "2026-10-22" })[0], /needs 3 closes, has 2/);
  assert.match(disqualifications({ row: row("a", [1, 2, 3], { fundedDate: "2026-10-22" }), params, periodStart: "2026-10-21" })[0], /joined after/);
  assert.ok(disqualifications({ row: row("a", [1, 2, 3], { fundedDate: "2026-10-22" }), params, periodStart: "2026-10-22" }).length === 0, "funded on the first day still counts");
  assert.match(disqualifications({ row: row("a", [1, 2, 3], { fundingCents: null }), params, periodStart: "2026-10-22" })[0], /no funding record/);
  assert.match(disqualifications({ row: row("a", [1, 2, 3], { statuses: ["ok", "partial"] }), params, periodStart: "2026-10-22" })[0], /not complete and verified/);
  assert.match(disqualifications({ row: row("a", [1, 2, 3], { activeDays: 0 }), params, periodStart: "2026-10-22" })[0], /needs 1 active days/);
});

test("ranking: score, then net, then profit factor, then lower drawdown, then closes, then key", () => {
  const base = { score: 60, netCents: 100, profitFactor: 2, ddPct: 1, n: 5, key: "m" };
  const order = (list) => list.sort(compareRanked).map((entry) => entry.key);
  assert.deepEqual(order([{ ...base, key: "low", score: 59.99 }, { ...base, key: "high", score: 60.01 }]), ["high", "low"]);
  assert.deepEqual(order([{ ...base, key: "b", netCents: 50 }, { ...base, key: "a", netCents: 200 }]), ["a", "b"]);
  assert.deepEqual(order([{ ...base, key: "pf2" }, { ...base, key: "inf", profitFactor: null }, { ...base, key: "pf1", profitFactor: 1 }]), ["inf", "pf2", "pf1"]);
  assert.deepEqual(order([{ ...base, key: "deep", ddPct: 3 }, { ...base, key: "shallow", ddPct: 1 }]), ["shallow", "deep"]);
  assert.deepEqual(order([{ ...base, key: "few", n: 3 }, { ...base, key: "many", n: 9 }]), ["many", "few"]);
  assert.deepEqual(order([{ ...base, key: "z" }, { ...base, key: "a" }]), ["a", "z"]);
});

test("a day: the best qualified account is crowned, and the order does not depend on input order", () => {
  const rows = [
    row("modest", [1_000, 1_000, -500, 1_000]),
    row("star", [4_000, 3_000, 5_000, -1_000, 4_000, 2_000]),
    row("thin", [9_000, 9_000]),            // two closes: cannot qualify
    row("loser", [-2_000, -1_000, -3_000, 500]),
  ];
  const forward = evaluatePeriod({ kind: "day", periodStart: "2026-10-22", rows }, rules);
  const backward = evaluatePeriod({ kind: "day", periodStart: "2026-10-22", rows: [...rows].reverse() }, rules);
  assert.equal(forward.crown.key, "star");
  assert.deepEqual(forward.rows.map((entry) => entry.key), backward.rows.map((entry) => entry.key));
  assert.deepEqual(forward.rows.map((entry) => entry.rank), [1, 2, 3, null]);
  const thin = forward.rows.find((entry) => entry.key === "thin");
  assert.equal(thin.qualified, false);
  assert.match(thin.why[0], /needs 3 closes, has 2/);
});

test("no crown when the leader's net result is not positive, or when nobody qualifies", () => {
  const losing = evaluatePeriod({ kind: "day", periodStart: "2026-10-22", rows: [row("a", [-100, -200, -300, 50]), row("b", [-500, -500, -500])] }, rules);
  assert.equal(losing.rows[0].rank, 1);
  assert.equal(losing.crown, null);
  const nobody = evaluatePeriod({ kind: "day", periodStart: "2026-10-22", rows: [row("a", [1, 2])] }, rules);
  assert.equal(nobody.crown, null);
  assert.equal(evaluatePeriod({ kind: "day", periodStart: "2026-10-22", rows: [] }, rules).crown, null);
});

test("a partial account with enough closes is withheld from the ranking, and listed as such", () => {
  const result = evaluatePeriod({
    kind: "day", periodStart: "2026-10-22",
    rows: [row("clean", [100, 200, 300]), row("flagged", [900, 900, 900], { statuses: ["partial"] })],
  }, rules);
  assert.equal(result.crown.key, "clean");
  assert.deepEqual(result.withheld, [{ key: "flagged", reason: "partial or unverified, so not eligible" }]);
});

test("ties are broken deterministically all the way down to the key", () => {
  const same = [100, 100, -50, 100];
  const result = evaluatePeriod({ kind: "day", periodStart: "2026-10-22", rows: [row("b", same), row("a", same)] }, rules);
  assert.deepEqual(result.rows.map((entry) => entry.key), ["a", "b"]);
});
