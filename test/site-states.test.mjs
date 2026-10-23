import test, { after } from "node:test";
import assert from "node:assert/strict";
import { hoursGeometry } from "../site/js/charts/geometry.mjs";
import { createData, dayFile, loadCore, verifyChain } from "../site/js/lib/data.mjs";
import { parseRoute } from "../site/js/lib/router.mjs";
import { accountKeys, dayEntry, seasonTotals } from "../site/js/lib/model.mjs";
import { viewFor } from "../site/js/views/index.mjs";
import { chainResultHtml } from "../site/js/views/integrity.mjs";
import { GRAMMAR, LEAKS, fsFetch } from "./helpers/site-data.mjs";
import { SEASONS, makeFixtureSite } from "./helpers/fixture-site.mjs";
import { checkMarkup, hashLinks, withoutCode } from "./helpers/markup.mjs";

/* The real season only has the states it has had so far. A dashboard also has to be right before
 * the first night, after a single night, across a gap, on a day frozen partial or unverified, on a
 * quiet day, and on the two days a year when the clocks change. This builds small seasons for those
 * with the project's own freeze code, then draws every page of each the way the browser would. */

const cleanups = [];
after(() => { for (const cleanup of cleanups) cleanup(); });

async function season(spec) {
  const site = makeFixtureSite(spec);
  cleanups.push(site.cleanup);
  const data = createData({ fetchImpl: fsFetch(site.root), build: "fx", retryDelays: [] });
  const core = await loadCore(data);
  const ctx = { data, core, state: { range: "all", isolated: null }, build: null };

  /* Draw a route and hold the markup to the same standard as the real season's pages. */
  async function draw(hash) {
    const route = parseRoute(hash);
    const view = viewFor(core, route);
    const out = view.render(await view.load(ctx, route), ctx);
    assert.ok(out.title.length > 0, `${hash} has a title`);
    const markup = String(out.markup);
    const problems = checkMarkup(markup);
    assert.deepEqual(problems, [], `${hash}: ${problems.join("; ")}`);
    const scan = withoutCode(markup);
    const leak = scan.match(LEAKS);
    assert.equal(leak, null, `${hash} shows "${leak?.[0]}" near: ${leak ? scan.slice(Math.max(0, leak.index - 60), leak.index + 60) : ""}`);
    const grammar = scan.match(GRAMMAR);
    assert.equal(grammar, null, `${hash} says "${grammar?.[0]}" near: ${grammar ? scan.slice(Math.max(0, grammar.index - 80), grammar.index + 60) : ""}`);
    for (const link of hashLinks(markup)) {
      const target = parseRoute(link);
      assert.notEqual(target.name, "notfound", `${hash} links to ${link}, which is not a route`);
      if (target.name === "day") assert.ok(dayEntry(core, target.date), `${hash} links to a day that is not frozen: ${link}`);
      if (target.name === "account") assert.ok(Object.hasOwn(core.reports, target.key), `${hash} links to an unknown account ${link}`);
    }
    return markup;
  }

  const pages = (extra = []) => ["#/", "#/calendar", "#/stars", "#/stars/week", "#/stars/month", "#/stars/all", "#/integrity", ...core.index.days.map((day) => `#/day/${day.date}`), ...accountKeys(core).map((key) => `#/account/${key}`), ...extra];
  return { site, data, core, draw, pages };
}

const EMPTY = await season(SEASONS.empty);
const ONE = await season(SEASONS.one);
const SPRING = await season(SEASONS.spring);
const MIXED = await season(SEASONS.mixed);

test("before the first night, every page explains itself instead of failing", async () => {
  const { core, draw, pages } = EMPTY;
  assert.equal(core.index.days.length, 0);
  assert.equal(core.index.tip, null);
  for (const hash of [...pages(), "#/calendar/2026-10", "#/day/2026-10-24", "#/account/nobody"]) {
    const markup = await draw(hash);
    assert.match(markup, /No day has been frozen yet/, hash);
    assert.match(markup, /Monday 19 October 2026/, `${hash} says when the season begins`);
    assert.match(markup, /Europe\/Berlin time/, hash);
    assert.equal((markup.match(/class="chip-account /g) ?? []).length, core.index.accounts.length, `${hash} lists every account`);
  }
  assert.match(await draw("#/nope"), /That address does not lead anywhere/, "the 404 stays a 404");
});

test("a season of one night uses the singular and has no worst day to compare", async () => {
  const { core, data, draw, pages } = ONE;
  for (const hash of pages()) await draw(hash);
  const home = await draw("#/");
  assert.match(home, /Net result of 3 demo accounts over 1 frozen day and 7 closed trades/);
  assert.match(home, /1 day with trades/);
  assert.match(home, /Best day/);
  assert.match(home, /needs a second day with trades/, "the worst day waits for a second day");
  assert.equal(seasonTotals(core).worst, null);
  assert.equal(seasonTotals(core).best.date, "2026-10-24");
  assert.match(await draw("#/account/Alpha"), /needs a second day with trades/);
  assert.match(String(chainResultHtml(await verifyChain(data, core))), /The one day checks out/);
  const late = await draw("#/account/Late");
  assert.match(late, /<h1[^>]*>.*Late/, "an account funded after the last frozen day still has a page");
});

test("a partial or unverified day says so, names the account and why, and links to its summary", async () => {
  const { draw } = MIXED;
  const unverified = await draw("#/day/2026-10-22");
  assert.match(unverified, /<aside class="notice" role="note" aria-labelledby="caution-h">/);
  assert.match(unverified, /Read these numbers with care/);
  assert.match(unverified, /Alpha[\s\S]{0,400}Unverified[\s\S]{0,200}do not add up to the account&#39;s balance/);
  assert.match(unverified, /href="#\/day\/2026-10-22\/file\/accounts\/Alpha\/summary\.md"/, "it points at the account's own explanation");
  assert.ok(!/Beta[^<]{0,80}<\/a> <span class="badge/.test(unverified.match(/<aside class="notice"[\s\S]*?<\/aside>/)[0]), "an account that was read in full is not named");

  const partial = await draw("#/day/2026-10-23");
  assert.match(partial, /<aside class="notice"/);
  assert.match(partial, /Beta[\s\S]{0,400}Partial[\s\S]{0,200}could not be read completely/);

  for (const date of ["2026-10-19", "2026-10-20", "2026-10-26"]) assert.ok(!/class="notice"/.test(await draw(`#/day/${date}`)), `${date} was read in full and carries no warning`);
});

test("the calendar flags the days that need care, and counts a lone close in the singular", async () => {
  const { core, draw } = MIXED;
  const calendar = await draw("#/calendar/2026-10");
  const flagged = core.index.days.filter((day) => day.status !== "complete").map((day) => day.date);
  assert.deepEqual(flagged, ["2026-10-22", "2026-10-23"]);
  assert.equal((calendar.match(/class="cal-flag"/g) ?? []).length, flagged.length);
  assert.match(calendar, /aria-label="Thursday 22 October 2026: [^"]*, partial"/);
  assert.match(calendar, /aria-label="Saturday 24 October 2026: no closes"/);
  assert.match(calendar, /aria-label="Tuesday 27 October 2026: \+5\.00, 1 close"/);
  assert.match(calendar, /Wednesday 21 October 2026: not frozen/, "the gap is a gap, not a zero");
  assert.match(calendar, /Partial or unverified/, "the legend explains the flag");
});

test("a quiet day, a gap and the day the clocks change each read correctly", async () => {
  const { draw } = MIXED;
  const quiet = await draw("#/day/2026-10-24");
  assert.match(quiet, /No trade closed on this day\./);
  assert.match(quiet, /No account closed a trade on this day\./);
  assert.ok(!/Every one of them|<p class="muted small"><\/p>/.test(quiet), "a day with no trades has no footnote about how they were opened");
  assert.match(await draw("#/day/2026-10-26"), /Every one of them was opened on this day\./);

  const gap = await draw("#/day/2026-10-21");
  assert.match(gap, /Nothing is frozen for this day/);
  const integrity = await draw("#/integrity");
  assert.match(integrity, /Wed 21 Oct 2026/, "the integrity page names the missing day");

  const long = await draw("#/day/2026-10-25");
  assert.match(long, /25-hour day/);
  assert.match(long, /lasted 25 hours and one clock hour happens twice/);
  assert.ok(!/clock hour/.test(await draw("#/day/2026-10-26")), "an ordinary day has no clock note");

  const spring = await SPRING.draw("#/day/2027-03-28");
  assert.match(spring, /23-hour day/);
  assert.match(spring, /lasted 23 hours and one clock hour does not exist/);
});

test("the entry-hours chart reads as a clock on a 25-hour and a 23-hour day, and loses no trade", async () => {
  const desk = await MIXED.data.json(dayFile("2026-10-25", "desk.json"));
  assert.equal(desk.hours.buckets.length, 25, "the record keeps both 02:00 hours apart");
  const doubled = desk.hours.buckets.filter((bucket) => bucket.h === "02:00");
  assert.equal(doubled.length, 2);
  assert.ok(doubled.every((bucket) => bucket.n > 0), "trades were opened in both");
  const long = hoursGeometry({ buckets: desk.hours.buckets, width: 600, height: 170 });
  assert.equal(long.bars.length, 24, "the page counts the repeated hour as one column");
  assert.equal(long.bars.find((bar) => bar.label === "02:00").n, doubled[0].n + doubled[1].n);
  assert.equal(long.total, desk.hours.total - desk.hours.earlier - desk.hours.unknown);

  const short = await SPRING.data.json(dayFile("2027-03-28", "desk.json"));
  assert.equal(short.hours.buckets.length, 23, "the hour that does not exist is not in the record");
  assert.equal(hoursGeometry({ buckets: short.hours.buckets, width: 600, height: 170 }).bars.length, 23);
});

test("a lone close, and the best and worst of a mixed season, are worded and linked right", async () => {
  const { core, draw } = MIXED;
  const lone = await draw("#/day/2026-10-27");
  assert.match(lone, /1 close · /);
  const home = await draw("#/");
  const totals = seasonTotals(core);
  assert.notEqual(totals.best.date, totals.worst.date);
  assert.match(home, new RegExp(`href="#/day/${totals.best.date}"`));
  assert.match(home, new RegExp(`href="#/day/${totals.worst.date}"`));
  assert.ok(!/needs a second day with trades/.test(home));
});

test("every page of every state draws, and the in-browser chain check passes across a gap and partial days", async () => {
  for (const state of [ONE, SPRING, MIXED]) {
    for (const hash of state.pages()) await state.draw(hash);
    const chain = await verifyChain(state.data, state.core);
    assert.equal(chain.ok, true);
    assert.equal(chain.rows.length, state.core.index.days.length);
  }
  assert.equal(MIXED.core.index.days.length, 8);
  assert.match(String(chainResultHtml(await verifyChain(MIXED.data, MIXED.core))), /All 8 days check out/);
});
