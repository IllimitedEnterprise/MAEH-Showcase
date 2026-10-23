import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDerived, checkDerived, loadModel, writeDerived } from "../scripts/lib/derived.mjs";
import { scanFiles } from "../scripts/lib/privacy.mjs";
import { ALLOW, RULES, ZONE, freeze, scratch } from "./helpers/days.mjs";

const STRONG = [[1, 1, 4_000], [2, 2, 3_000], [3, 3, 5_000], [4, 4, -1_000]];
const MOD = [[1, 1, 100], [2, 2, 100], [3, 3, 100]];
const LOSS = [[1, 1, -500], [2, 2, -500], [3, 3, -500]];
const TWO = [[1, 1, 1_000], [2, 2, 1_000]];
const TWO_SMALL = [[1, 1, 100], [2, 2, 100]];

/* Mon 2026-10-26 .. Mon 2026-11-02: one full ISO week (W44), the end of October, and a new week. */
const SEASON = [
  ["2026-10-26", { Alpha: STRONG, Beta: MOD }],
  ["2026-10-27", { Alpha: STRONG, Beta: MOD }],
  ["2026-10-28", { Alpha: LOSS, Beta: MOD }],
  ["2026-10-29", { Alpha: TWO, Beta: TWO_SMALL }],
  ["2026-10-30", { Alpha: MOD, Beta: STRONG }],
  ["2026-10-31", { Alpha: STRONG, Beta: MOD }],
  ["2026-11-01", {}],
  ["2026-11-02", { Alpha: STRONG }],
];

const rulesWith = (patch) => (version) => (version === "v1" ? { ...RULES, ...patch } : null);
const plain = (version) => (version === "v1" ? RULES : null);

function frozenSeason(root, skip = []) {
  for (const [date, perAccount] of SEASON) if (!skip.includes(date)) freeze(root, date, perAccount);
}
const model = (root, rulesFor = plain) => loadModel(root, { seasonStart: "2026-10-26", zone: ZONE, allow: ALLOW, rulesFor });
const derive = (root, rulesFor) => buildDerived(model(root, rulesFor));
const json = (files, path) => JSON.parse(files.get(path));

test("day crowns are the ones sealed in each day, and the tally counts them", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const crowns = json(derive(root), "stars/crowns.json");
    const days = crowns.awards.filter((award) => award.kind === "day").map((award) => [award.period, award.key]);
    assert.deepEqual(days, [["2026-10-26", "Alpha"], ["2026-10-27", "Alpha"], ["2026-10-28", "Beta"], ["2026-10-30", "Beta"], ["2026-10-31", "Alpha"], ["2026-11-02", "Alpha"]]);
    const alpha = crowns.tally.find((row) => row.key === "Alpha");
    const beta = crowns.tally.find((row) => row.key === "Beta");
    assert.equal(alpha.day, 4);
    assert.equal(beta.day, 2);
  } finally { cleanup(); }
});

test("a streak is consecutive crowned days by one account: a quiet day is transparent, another winner breaks it", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const tally = json(derive(root), "stars/crowns.json").tally;
    const alpha = tally.find((row) => row.key === "Alpha").streak;
    const beta = tally.find((row) => row.key === "Beta").streak;
    assert.deepEqual(alpha, { cur: 2, best: 2, bestFrom: "2026-10-26", bestTo: "2026-10-27" });
    assert.deepEqual(beta, { cur: 0, best: 2, bestFrom: "2026-10-28", bestTo: "2026-10-30" });
  } finally { cleanup(); }
});

test("a week is crowned only when every one of its days is frozen", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const crowns = json(derive(root), "stars/crowns.json");
    const week = crowns.awards.find((award) => award.kind === "week");
    assert.equal(week.period, "2026-W44");
    assert.equal(week.key, "Alpha");
    assert.deepEqual([week.start, week.end, week.partialPeriod, week.basis], ["2026-10-26", "2026-11-01", false, "nightly"]);
    assert.ok(crowns.periods.some((period) => period.kind === "week" && period.period === "2026-W44" && period.crown.key === "Alpha"));
  } finally { cleanup(); }
});

test("a gap in the week means no week crown, and the gap is listed in the catalogue", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root, ["2026-10-29"]);
    const files = derive(root);
    assert.ok(!json(files, "stars/crowns.json").awards.some((award) => award.kind === "week"));
    assert.deepEqual(json(files, "results/index.json").gaps, ["2026-10-29"]);
  } finally { cleanup(); }
});

test("a month needs its own, longer evidence: with the real rules October has no crown, with looser ones it does", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const strict = json(derive(root), "stars/crowns.json");
    assert.ok(!strict.awards.some((award) => award.kind === "month"), "20 closes is not enough for a month");
    const october = strict.periods.find((period) => period.kind === "month" && period.period === "2026-10");
    assert.equal(october.crown, null);
    assert.equal(october.partialPeriod, true, "the season began on the 26th, so October is a partial month");

    const loose = json(derive(root, rulesWith({ periods: { ...RULES.periods, month: { ...RULES.periods.month, minCloses: 10 } } })), "stars/crowns.json");
    const award = loose.awards.find((entry) => entry.kind === "month");
    assert.deepEqual([award.period, award.key, award.partialPeriod], ["2026-10", "Alpha", true]);
    assert.equal(loose.tally.find((row) => row.key === "Alpha").month, 1);
  } finally { cleanup(); }
});

test("points: a day crown 1, a week crown 5, a month crown 20", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const tally = json(derive(root), "stars/crowns.json").tally;
    assert.equal(tally[0].key, "Alpha");
    assert.equal(tally[0].points, 4 * 1 + 1 * 5);
    assert.equal(tally[1].points, 2);
  } finally { cleanup(); }
});

test("an unfinished period is shown as leading, never as a crown", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const board = json(derive(root), "stars/leaderboard.json");
    assert.equal(board.asOf, "2026-11-02");
    assert.equal(board.day.crown.key, "Alpha");
    assert.deepEqual([board.week.period, board.week.provisional, board.week.complete, board.week.through, board.week.crown], ["2026-W45", true, false, "2026-11-02", null]);
    assert.equal(board.week.leader, null, "one day cannot reach the closes a week needs");
    assert.ok(board.week.rows.find((row) => row.key === "Alpha").why.some((line) => /needs 10 closes, has 4/.test(line)));
    assert.deepEqual([board.month.period, board.month.provisional], ["2026-11", true]);
  } finally { cleanup(); }
});

test("the last day of a period makes it complete on the leaderboard", () => {
  const { root, cleanup } = scratch();
  try {
    for (const [date, perAccount] of SEASON.slice(0, 7)) freeze(root, date, perAccount);
    const board = json(derive(root), "stars/leaderboard.json");
    assert.equal(board.asOf, "2026-11-01");
    assert.deepEqual([board.week.period, board.week.complete, board.week.provisional, board.week.crown.key], ["2026-W44", true, false, "Alpha"]);
  } finally { cleanup(); }
});

test("history keeps what each day looked like then, including the tally as it stood", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const files = derive(root);
    const early = json(files, "stars/history/2026-10-27.json");
    assert.equal(early.day.crown.key, "Alpha");
    assert.equal(early.tally.find((row) => row.key === "Alpha").day, 2);
    assert.equal(early.week.complete, false);
    const late = json(files, "stars/history/2026-11-01.json");
    assert.equal(late.week.complete, true);
    assert.equal(late.tally.find((row) => row.key === "Alpha").week, 1);
    assert.ok(files.has("stars/history/2026-11-02.json"));
    assert.equal(json(files, "stars/history/2026-10-26.json").tally.find((row) => row.key === "Beta").day, 0);
  } finally { cleanup(); }
});

test("an account report holds the whole story: totals, form, pairs, hours and crowns", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const alpha = json(derive(root), "stars/accounts/Alpha.json");
    assert.equal(alpha.totals.n, 24);
    assert.equal(alpha.totals.days, 8);
    assert.equal(alpha.totals.activeDays, 7);
    assert.equal(alpha.totals.net, 448);
    assert.equal(alpha.form.length, 8);
    assert.deepEqual(alpha.form.filter((day) => day.crowned).map((day) => day.date), ["2026-10-26", "2026-10-27", "2026-10-31", "2026-11-02"]);
    assert.deepEqual(alpha.bestDay, { date: "2026-10-26", net: 110 });
    assert.deepEqual(alpha.worstDay, { date: "2026-10-28", net: -15 });
    assert.deepEqual(alpha.pairs, [{ symbol: "EURUSD", n: 24, net: 448 }]);
    assert.equal(alpha.hours.total, 24);
    assert.equal(alpha.hours.buckets.reduce((total, bucket) => total + bucket.n, 0) + alpha.hours.earlier + alpha.hours.unknown, 24);
    assert.deepEqual(alpha.crowns.awards.filter((award) => award.kind === "week"), [{ kind: "week", period: "2026-W44" }]);
    const late = json(derive(root), "stars/accounts/Late.json");
    assert.equal(late.totals.n, 0);
    assert.ok(late.form.every((day) => day.status === "quiet"));
  } finally { cleanup(); }
});

test("an account funded after the first day is prefunding until then, with no figures", () => {
  const { root, cleanup } = scratch();
  try {
    freeze(root, "2026-10-24", { Alpha: STRONG });
    freeze(root, "2026-10-25", { Alpha: STRONG });
    const files = loadModel(root, { seasonStart: "2026-10-24", zone: ZONE, allow: ALLOW, rulesFor: plain });
    const derived = buildDerived(files);
    const late = json(derived, "stars/accounts/Late.json");
    assert.deepEqual(late.form.map((day) => day.status), ["prefunding", "quiet"]);
    assert.equal(late.totals.days, 1);
    const series = json(derived, "results/series.json");
    assert.deepEqual(series.days[0].accounts.Late, { status: "prefunding", n: 0, net: null, cum: null });
  } finally { cleanup(); }
});

test("the catalogue and the series line up with the days", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const files = derive(root);
    const index = json(files, "results/index.json");
    assert.equal(index.days.length, 8);
    assert.deepEqual([index.tip.seq, index.tip.date], [8, "2026-11-02"]);
    assert.deepEqual(index.gaps, []);
    assert.deepEqual(index.days.map((day) => day.crown), ["Alpha", "Alpha", "Beta", null, "Beta", "Alpha", null, "Alpha"]);
    const series = json(files, "results/series.json");
    assert.equal(series.days.length, 8);
    assert.equal(series.days.at(-1).desk.cum, 572);
    assert.equal(series.days.at(-1).accounts.Alpha.cum, 448);
    assert.equal(series.days.at(-1).accounts.Beta.cum, 124);
  } finally { cleanup(); }
});

test("an empty season derives cleanly: no days, no crowns, a tally of zeros", () => {
  const { root, cleanup } = scratch();
  try {
    const files = derive(root);
    const board = json(files, "stars/leaderboard.json");
    assert.deepEqual([board.asOf, board.day, board.week, board.month], [null, null, null, null]);
    assert.ok(board.tally.every((row) => row.points === 0));
    assert.equal(json(files, "results/index.json").tip, null);
    assert.ok(files.has("stars/RULES.md"));
  } finally { cleanup(); }
});

test("the same days always derive to the same bytes", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    assert.deepEqual([...derive(root).entries()], [...derive(root).entries()]);
  } finally { cleanup(); }
});

test("derived files carry nothing the privacy scan objects to", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const found = scanFiles(derive(root));
    assert.deepEqual(found, []);
  } finally { cleanup(); }
});

test("write, then check: a rebuild matches; an edit, a deletion and a stray file are all caught", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const files = derive(root);
    writeDerived(root, files);
    assert.deepEqual(checkDerived(root, files), []);

    writeFileSync(join(root, "stars/leaderboard.md"), "# I was edited\n");
    writeFileSync(join(root, "stars/old.json"), "{}\n");
    const found = checkDerived(root, files);
    assert.ok(found.some((finding) => finding.file === "stars/leaderboard.md" && /differs from a rebuild/.test(finding.message)));
    assert.ok(found.some((finding) => finding.file === "stars/old.json" && /would not produce/.test(finding.message)));

    const result = writeDerived(root, files);
    assert.deepEqual(result.removed, ["stars/old.json"]);
    assert.deepEqual(checkDerived(root, files), []);
    assert.ok(!existsSync(join(root, "stars/old.json")));
    assert.equal(readFileSync(join(root, "stars/leaderboard.md"), "utf8"), files.get("stars/leaderboard.md"));
  } finally { cleanup(); }
});

test("the rules file is described in words that match the numbers", () => {
  const { root, cleanup } = scratch();
  try {
    frozenSeason(root);
    const rules = derive(root).get("stars/RULES.md");
    assert.match(rules, /Rules version \*\*v1\*\*/);
    assert.match(rules, /\| week \| 6 \| 10 \| 40 \| 10 \| 2 \|/);
    assert.match(rules, /A day crown is worth 1, a week crown 5, a month crown 20/);
    assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(rules));
  } finally { cleanup(); }
});
