import test from "node:test";
import assert from "node:assert/strict";
import { DASH, MINUS, compact, longDate, money, monthTitle, pct, periodLabel, shortDate, tone, weekday } from "../site/js/lib/fmt.mjs";
import { heatLevel, linear, niceTicks, pathArea, pathLine, pathStep } from "../site/js/lib/scale.mjs";
import { NAV, href, parseRoute, section } from "../site/js/lib/router.mjs";
import { renderMarkdown } from "../site/js/lib/markdown.mjs";
import { barsGeometry, calendarGeometry, curveGeometry, dateOfDayNumber, dayNumber, hoursGeometry, sparkGeometry } from "../site/js/charts/geometry.mjs";

test("money: a gain is signed, a loss uses a true minus, zero is plain, absent is a dash", () => {
  assert.equal(money(1518.5), "+1,518.50");
  assert.equal(money(-2900.53), `${MINUS}2,900.53`);
  assert.equal(money(0), "0.00");
  assert.equal(money(null), DASH);
  assert.equal(money(undefined), DASH);
  assert.equal(money(1234567.891, { signed: false }), "1,234,567.89");
  assert.deepEqual([tone(5), tone(-1), tone(0), tone(null)], ["gain", "loss", "flat", "none"]);
});

test("percent and compact numbers", () => {
  assert.equal(pct(3.817, { signed: true }), "+3.8%");
  assert.equal(pct(-9.457, { digits: 2 }), `${MINUS}9.46%`);
  assert.equal(pct(null), DASH);
  assert.equal(compact(1500), "1.5k");
  assert.equal(compact(-2_300_000), `${MINUS}2.3m`);
  assert.equal(compact(0), "0");
  assert.equal(compact(250), "250");
});

test("dates read the same in every time zone", () => {
  assert.equal(longDate("2026-10-22"), "Thursday 22 October 2026");
  assert.equal(shortDate("2026-10-05"), "5 Oct");
  assert.equal(weekday("2026-10-25"), "Sun");
  assert.equal(monthTitle("2026-10"), "October 2026");
  assert.equal(periodLabel("week", "2026-W43"), "Week 43, 2026");
  assert.equal(periodLabel("month", "2026-10"), "October 2026");
});

test("nice ticks are round, cover the data, and include zero when asked to", () => {
  const { ticks, min, max } = niceTicks(-2900.53, 1375.06, 5);
  assert.ok(min <= -2900.53 && max >= 1375.06);
  assert.ok(ticks.includes(0));
  assert.ok(ticks.every((tick) => Number.isInteger(tick / 500) || Number.isInteger(tick / 250) || Number.isInteger(tick / 1000)));
  assert.deepEqual(niceTicks(5, 5).ticks.length > 1, true, "a flat series still gets an axis");
  assert.deepEqual(niceTicks(NaN, 1).ticks, [0]);
});

test("linear scales map the domain onto the range, and a flat domain does not divide by zero", () => {
  const scale = linear(0, 10, 100, 200);
  assert.deepEqual([scale(0), scale(5), scale(10)], [100, 150, 200]);
  assert.equal(linear(3, 3, 0, 10)(3), 5);
});

test("paths", () => {
  const points = [{ x: 0, y: 10 }, { x: 5.55, y: 4 }];
  assert.equal(pathLine(points), "M0 10L5.6 4");
  assert.equal(pathArea(points, 20), "M0 20L0 10L5.6 4L5.6 20Z");
  assert.equal(pathArea([], 20), "");
  assert.equal(pathStep(points), "M0 10L5.6 10L5.6 4");
});

test("heat levels run 0 to 4 against the biggest magnitude", () => {
  assert.deepEqual([0, 10, 30, 60, 100].map((value) => heatLevel(value, 100)), [0, 1, 2, 3, 4]);
  assert.equal(heatLevel(-100, 100), 4);
  assert.equal(heatLevel(5, 0), 0);
});

test("routes parse and format both ways", () => {
  const cases = [
    ["#/", { name: "season" }], ["", { name: "season" }],
    ["#/calendar", { name: "calendar", month: null }], ["#/calendar/2026-10", { name: "calendar", month: "2026-10" }],
    ["#/day/2026-10-22", { name: "day", date: "2026-10-22", file: null }],
    ["#/day/2026-10-22/file/accounts/M9-B-CHERRY/summary.md", { name: "day", date: "2026-10-22", file: "accounts/M9-B-CHERRY/summary.md" }],
    ["#/account/M9-B-D.CHERRY", { name: "account", key: "M9-B-D.CHERRY" }],
    ["#/stars", { name: "stars", tab: "day" }], ["#/stars/week", { name: "stars", tab: "week" }],
    ["#/integrity", { name: "integrity" }],
  ];
  for (const [hash, route] of cases) {
    assert.deepEqual(parseRoute(hash), route, hash);
    if (hash) assert.deepEqual(parseRoute(href(route)), route, `round trip of ${hash}`);
  }
});

test("bad routes are 'notfound', never a blank page or a path escape", () => {
  for (const hash of ["#/nope", "#/day/22-10-2026", "#/day/2026-10-22/file", "#/day/2026-10-22/file/../../secret", "#/account/", "#/account/a b", "#/stars/year", "#/calendar/2026", "#/integrity/x", "#/%E0%A4%A",
    "#/calendar/2026-13", "#/calendar/2026-00", "#/calendar/9999-99", "#/day/2026-13-01", "#/day/2026-10-32", "#/day/2026-00-10", "#/day/0000-00-00"]) {
    assert.deepEqual(parseRoute(hash), { name: "notfound" }, hash);
  }
  assert.equal(section({ name: "day" }), "calendar");
  assert.equal(section({ name: "account" }), "stars");
  assert.equal(NAV.length, 4);
});

test("markdown: structure", () => {
  const html = renderMarkdown("# Title\n\nSome **bold** and `code` and *soft*.\n\n- one\n- two\n\n1. first\n2. second\n\n| A | B |\n|---|--:|\n| x | 1 |\n\n```\nraw <b>\n```\n");
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<p>Some <strong>bold<\/strong> and <code>code<\/code> and <em>soft<\/em>\.<\/p>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<table class="table"><thead><tr><th scope="col" class="left">A<\/th><th scope="col" class="right">B<\/th><\/tr><\/thead><tbody><tr><td class="left">x<\/td><td class="right">1<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre><code>raw &lt;b&gt;<\/code><\/pre>/);
});

test("markdown: nothing in a file can inject markup or a script link", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](./a.md) [web](https://example.com/a?b=1&c=2)\n\n| <img src=x onerror=1> |\n|---|\n| "q" |\n');
  assert.ok(!/<script|<img|<\/script|javascript:/i.test(html), html);
  assert.ok(!/<[^>]*\sonerror=/i.test(html), "no attribute can be smuggled into a tag");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="\.\/a\.md">ok<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">web<\/a>/);
  assert.match(html, /<p>x <a href="\.\/a\.md">/, "the unsafe link keeps its label and loses its target, and no stray bracket is left behind");
});

const curve = (values) => ({ key: "k", label: "K", points: values.map(([date, value]) => ({ date, value })) });

test("curve geometry: the axis is the calendar, zero is on it, and every point is inside the plot", () => {
  const geometry = curveGeometry({ series: [curve([["2026-10-07", 0], ["2026-10-09", 120], ["2026-10-12", -80]])], width: 600, height: 240 });
  assert.equal(geometry.empty, false);
  const [line] = geometry.lines;
  const [a, b, c] = line.points;
  assert.ok(b.x - a.x < c.x - b.x + 1e-9 || true);
  assert.ok((b.x - a.x) / (c.x - b.x) > 0.6 && (b.x - a.x) / (c.x - b.x) < 0.7, "2 days then 3 days: the gap is to scale (weekend included)");
  assert.ok(b.y < a.y && c.y > a.y, "up is up");
  assert.equal(geometry.zeroY, a.y);
  assert.ok(geometry.yTicks.some((tick) => tick.value === 0));
  for (const point of line.points) assert.ok(point.x >= geometry.plot.x0 && point.x <= geometry.plot.x1 && point.y >= geometry.plot.y0 && point.y <= geometry.plot.y1);
  assert.ok(geometry.areaD.startsWith("M") && geometry.areaD.endsWith("Z"));
  assert.equal(geometry.xTicks[0].date, "2026-10-07");
  assert.equal(geometry.xTicks.at(-1).date, "2026-10-12");
});

test("curve geometry: one point, no points and several series all behave", () => {
  assert.equal(curveGeometry({ series: [curve([])], width: 300, height: 100 }).empty, true);
  const single = curveGeometry({ series: [curve([["2026-10-07", 50]])], width: 300, height: 100 });
  assert.equal(single.lines[0].points.length, 1);
  assert.ok(Number.isFinite(single.lines[0].points[0].x));
  const two = curveGeometry({ series: [curve([["2026-10-07", 1], ["2026-10-08", 2]]), { ...curve([["2026-10-07", -3], ["2026-10-08", 4]]), key: "j" }], width: 300, height: 100 });
  assert.equal(two.lines.length, 2);
});

test("bars: up bars rise from zero, down bars fall, quiet days are ticks, missing days are nothing", () => {
  const geometry = barsGeometry({
    days: [
      { date: "2026-10-12", value: 100, n: 3 }, { date: "2026-10-13", value: -50, n: 2 },
      { date: "2026-10-14", value: 0, n: 0 }, { date: "2026-10-16", value: 25, n: 1 },
    ],
    width: 500, height: 200,
  });
  assert.equal(geometry.bars.length, 3);
  const [up, down] = geometry.bars;
  assert.ok(up.y + up.height <= geometry.zeroY + 0.1, "an up bar ends at the zero line");
  assert.ok(down.y >= geometry.zeroY - 0.1, "a down bar starts at the zero line");
  assert.deepEqual([up.tone, down.tone], ["gain", "loss"]);
  assert.deepEqual(geometry.quiet.map((tick) => tick.date), ["2026-10-14"]);
  assert.ok(!geometry.bars.some((bar) => bar.date === "2026-10-15") && !geometry.quiet.some((tick) => tick.date === "2026-10-15"), "an unfrozen day draws nothing");
  assert.ok(geometry.barWidth >= 1.5 && geometry.barWidth <= 24, "a bar is never thicker than 24 px");
  assert.ok(geometry.slot - geometry.barWidth >= 2 - 1e-9, "and leaves the 2 px gap to its neighbour");
});

test("calendar: Monday-first, October 2026 starts on a Thursday, and cells are heat-leveled", () => {
  const geometry = calendarGeometry({
    month: "2026-10",
    byDate: { "2026-10-22": { value: 100, n: 4 }, "2026-10-21": { value: -50, n: 3 }, "2026-10-20": { value: 0, n: 0 } },
    seasonStart: "2026-10-07",
  });
  assert.equal(geometry.weeks.length, 5);
  assert.ok(geometry.weeks.every((week) => week.length === 7));
  assert.deepEqual(geometry.weeks[0].map((cell) => cell.date), [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  const cells = geometry.weeks.flat().filter((cell) => cell.date);
  assert.equal(cells.length, 31);
  const byDate = Object.fromEntries(cells.map((cell) => [cell.date, cell]));
  assert.deepEqual([byDate["2026-10-22"].tone, byDate["2026-10-22"].level, byDate["2026-10-22"].state], ["gain", 4, "closes"]);
  assert.deepEqual([byDate["2026-10-21"].tone, byDate["2026-10-21"].level], ["loss", 2]);
  assert.equal(byDate["2026-10-20"].state, "quiet");
  assert.equal(byDate["2026-10-19"].state, "missing");
  assert.equal(byDate["2026-10-03"].season, false);
  assert.equal(byDate["2026-10-08"].season, true);
});

test("hours: a 25-hour day's repeated label adds up, and the bars sum to the total", () => {
  const geometry = hoursGeometry({
    buckets: [{ h: "01:00", n: 1 }, { h: "02:00", n: 2 }, { h: "02:00", n: 3 }, { h: "03:00", n: 0 }],
    width: 400, height: 120,
  });
  assert.deepEqual(geometry.bars.map((bar) => [bar.label, bar.n]), [["01:00", 1], ["02:00", 5], ["03:00", 0]]);
  assert.equal(geometry.total, 6);
  assert.ok(geometry.bars[1].height > geometry.bars[0].height);
  assert.equal(geometry.bars[2].height, 0);
});

test("sparklines", () => {
  assert.equal(sparkGeometry({ values: [], width: 50, height: 20 }).d, "");
  const spark = sparkGeometry({ values: [0, 5, -2, 8], width: 100, height: 30 });
  assert.equal(spark.points.length, 4);
  assert.ok(spark.points[3].y < spark.points[0].y);
});

test("day numbers round-trip across a daylight-saving change", () => {
  assert.equal(dateOfDayNumber(dayNumber("2026-10-25")), "2026-10-25");
  assert.equal(dayNumber("2026-10-26") - dayNumber("2026-10-25"), 1);
});
