import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { html, join, raw } from "../site/js/lib/html.mjs";
import { parseStyleData } from "../site/js/lib/dom.mjs";
import { parseCsv } from "../site/js/lib/csv.mjs";
import { DataError, createData, dayDir, dayFile, loadCore, loadDay, loadFile, sha256Hex } from "../site/js/lib/data.mjs";
import { accountKeys, accountSeries, dailyBars, dayEntry, deskSeries, entityClass, entitySlot, lastDays, missingDates, monthsAvailable, neighbours, seasonTotals, shiftMonth, standings } from "../site/js/lib/model.mjs";
import { barPath, barsChart, chartTable, curveChart, hoursChart, sparkline } from "../site/js/charts/draw.mjs";
import { LEAKS, fsFetch } from "./helpers/site-data.mjs";

test("html escapes every interpolated value and trusts only its own templates", () => {
  const hostile = `"><script>alert(1)</script>'&`;
  const out = String(html`<p title="${hostile}">${hostile}</p>`);
  assert.ok(!out.includes("<script>"), out);
  assert.match(out, /&quot;&gt;&lt;script&gt;/);
  assert.equal(String(html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}</ul>`), "<ul><li>1</li><li>2</li></ul>");
  assert.equal(String(html`${null}${undefined}${false}${true}${0}`), "0");
  assert.equal(String(html`<b>${html`<i>x</i>`}</b>`), "<b><i>x</i></b>");
  assert.equal(String(html`${"<i>x</i>"}`), "&lt;i&gt;x&lt;/i&gt;", "plain strings are never trusted");
  assert.equal(String(join(["a", "<b>"], ", ")), "a, &lt;b&gt;");
  assert.equal(String(raw("<hr>")), "<hr>");
});

test("data-style only ever sets custom properties with plain values", () => {
  assert.deepEqual(parseStyleData("--w:37%;--c:#ff0044;--x: rgba(1, 2, 3, .5)"), [["--w", "37%"], ["--c", "#ff0044"], ["--x", "rgba(1, 2, 3, .5)"]]);
  assert.deepEqual(parseStyleData("width:10px;--ok:1"), [["--ok", "1"]], "a real property is dropped");
  assert.deepEqual(parseStyleData("--bg:url(https://evil.example/x)"), [], "no url()");
  assert.deepEqual(parseStyleData("--a:1;;--b"), [["--a", "1"]]);
  assert.deepEqual(parseStyleData(`--a:"quoted"`), []);
});

test("csv reads the files the repository writes, and quotes when a person edits one", () => {
  assert.deepEqual(parseCsv("i,symbol,side,net,r\n1,XAGUSD,short,1004.60,0.54\n2,XAGUSD,short,1290.47,0.775\n"), {
    header: ["i", "symbol", "side", "net", "r"],
    rows: [["1", "XAGUSD", "short", "1004.60", "0.54"], ["2", "XAGUSD", "short", "1290.47", "0.775"]],
  });
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n').rows, [["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("").rows, []);
});

test("sha-256 matches the reference vector", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the loader caches, versions urls, and turns failures into DataError", async () => {
  let calls = 0;
  const seen = [];
  const data = createData({
    build: "abc 1",
    fetchImpl: async (url) => {
      calls += 1;
      seen.push(url);
      if (url.startsWith("missing")) return { ok: false, status: 404 };
      if (url.startsWith("broken")) return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } };
      if (url.startsWith("down")) throw new TypeError("network");
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  await data.json("a.json");
  await data.json("a.json");
  assert.equal(calls, 1, "the second read is served from memory");
  assert.equal(seen[0], "a.json?v=abc%201");
  await assert.rejects(data.json("missing.json"), (error) => error instanceof DataError && error.status === 404);
  await assert.rejects(data.json("broken.json"), /not valid JSON/);
  await assert.rejects(data.json("down.json"), /Could not reach/);
  await data.json("missing.json").catch(() => {});
  assert.equal(calls, 5, "a failed read is not cached, so a retry asks again");
});

test("day paths follow the repository layout", () => {
  assert.equal(dayDir("2026-10-22"), "results/2026/10/2026-10-22");
  assert.equal(dayFile("2026-10-22", "accounts/M9-S-B/trades.json"), "results/2026/10/2026-10-22/accounts/M9-S-B/trades.json");
});

const data = createData({ fetchImpl: fsFetch(), build: "test" });
const core = await loadCore(data);

test("the real committed data loads, and every account has a report", () => {
  assert.equal(core.index.days.length, 16);
  assert.equal(accountKeys(core).length, 8);
  assert.deepEqual(Object.keys(core.reports).sort(), [...accountKeys(core)].sort());
});

test("a file's bytes are checked against the manifest from the viewer's side", async () => {
  const manifest = await loadDay(data, "2026-10-22");
  const day = dayEntry(core, "2026-10-22");
  const file = await loadFile(data, "2026-10-22", "desk.json", manifest.files["desk.json"]);
  assert.equal(file.ok, true);
  assert.equal(file.actual, createHash("sha256").update(file.text).digest("hex"));
  const own = await loadFile(data, "2026-10-22", "day.json", { sha256: day.sha256 });
  assert.equal(own.ok, true, "day.json matches the hash the catalogue and the chain hold");
  const wrong = await loadFile(data, "2026-10-22", "desk.json", { sha256: "0".repeat(64), bytes: file.size });
  assert.equal(wrong.ok, false);
  const unknown = await loadFile(data, "2026-10-22", "desk.json", undefined);
  assert.equal(unknown.ok, null, "no record to compare with is not a pass");
});

test("every frozen day's every file matches its manifest in the way the browser checks it", async () => {
  for (const day of core.index.days) {
    const manifest = await loadDay(data, day.date);
    const own = await loadFile(data, day.date, "day.json", { sha256: day.sha256 });
    assert.equal(own.ok, true, `${day.date} day.json`);
    for (const [rel, entry] of Object.entries(manifest.files)) {
      const file = await loadFile(data, day.date, rel, entry);
      assert.equal(file.ok, true, `${day.date}/${rel}`);
    }
  }
});

test("model: totals, series, neighbours and months agree with the files", () => {
  const totals = seasonTotals(core);
  assert.equal(totals.frozen, 16);
  assert.equal(totals.start, "2026-10-07");
  assert.equal(totals.end, "2026-10-22");
  assert.equal(totals.closes, Object.values(core.reports).reduce((sum, report) => sum + report.totals.n, 0), "the home page and the eight account reports count the same closes");
  const desk = deskSeries(core);
  assert.equal(desk.at(-1).value, totals.net, "the last cumulative is the season net");
  assert.deepEqual(neighbours(core, "2026-10-07"), { prev: null, next: "2026-10-08" });
  assert.deepEqual(neighbours(core, "2026-10-22"), { prev: "2026-10-21", next: null });
  assert.deepEqual(monthsAvailable(core), ["2026-10"]);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(missingDates(core), []);
  assert.equal(lastDays(desk, 7).length, 7);
  assert.equal(lastDays(desk, 99).length, 16);
  const unfunded = accountSeries(core, "M9-L-Mix");
  assert.equal(unfunded[0].date, "2026-10-21", "no zeros are invented before the account existed");
  assert.equal(dailyBars(core).length, 16);
  assert.equal(entitySlot(core, "M9-B-CHERRY"), 1);
  assert.equal(entityClass(core, "M9-Y-SINGLE"), "ent-8");
  assert.equal(entityClass(core, "nobody"), "ent-x");
  assert.equal(standings(core, "week").kind, "week");
  assert.equal(standings(core, "day").date, "2026-10-22");
});

test("the season net the home page shows is the sum of the eight accounts' own totals", () => {
  const fromReports = Object.values(core.reports).reduce((sum, report) => sum + report.totals.net, 0);
  assert.ok(Math.abs(fromReports - seasonTotals(core).net) < 0.011, `${fromReports} vs ${seasonTotals(core).net}`);
});

const uid = "t1";
const curveSeries = (slot = 0) => [{ key: "desk", label: "Desk", slot, points: deskSeries(core).map((d) => ({ date: d.date, value: d.value })) }];

test("curve: one series is ink with a gain/loss wash and a labelled end", () => {
  const { markup, model } = curveChart({ uid, title: "Desk <net>", description: "d", series: curveSeries(), width: 640 });
  const text = String(markup);
  assert.ok(!LEAKS.test(text), text.match(LEAKS)?.[0]);
  assert.match(text, /role="img"/);
  assert.match(text, /<title id="t1-t">Desk &lt;net&gt;<\/title>/);
  assert.equal((text.match(/class="line line-ink/g) ?? []).length, 1);
  assert.equal((text.match(/class="wash"/g) ?? []).length, 2, "gain above zero, loss below");
  assert.match(text, /class="end-label"/);
  assert.equal(model.count, 16);
  const point = model.at(15);
  assert.equal(point.date, "2026-10-22");
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.tipY));
  assert.match(String(point.tip), /Thursday 22 October 2026/);
  assert.match(point.speak, /October 2026/);
});

test("curve: several series each wear their own account colour, and an isolated one dims the rest", () => {
  const series = accountKeys(core).map((key, index) => ({ key, label: key, slot: index + 1, points: accountSeries(core, key).map((d) => ({ date: d.date, value: d.value })) }));
  const all = curveChart({ uid, title: "t", description: "d", series, width: 720 });
  const text = String(all.markup);
  assert.ok(!LEAKS.test(text), text.match(LEAKS)?.[0]);
  for (let slot = 1; slot <= 8; slot += 1) assert.match(text, new RegExp(`stroke-ent-${slot}`));
  assert.ok(!/is-dim/.test(text));
  assert.ok(!/class="wash"/.test(text), "no wash when several lines overlap");
  const isolated = String(curveChart({ uid, title: "t", description: "d", series, width: 720, isolated: "M9-S-B" }).markup);
  assert.equal((isolated.match(/is-dim/g) ?? []).length, 7);
  const tip = String(all.model.at(15).tip);
  const values = [...tip.matchAll(/class="tip-value">([^<]+)</g)].map((m) => m[1]);
  assert.equal(values.length, 8, "one tooltip lists every series at that day");
  const numbers = values.map((v) => Number(v.replace("−", "-").replace(/,/g, "")));
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a), "highest first");
});

test("curve: an empty or one-point series still draws something honest", () => {
  assert.match(String(curveChart({ uid, title: "t", description: "d", series: [{ key: "k", label: "K", slot: 0, points: [] }], width: 400 }).markup), /Nothing to draw/);
  const one = curveChart({ uid, title: "t", description: "d", series: [{ key: "k", label: "K", slot: 0, points: [{ date: "2026-10-07", value: 12 }] }], width: 400 });
  assert.ok(!LEAKS.test(String(one.markup)));
  assert.equal(one.model.count, 1);
});

test("bars: rounded at the data end, square at the baseline, quiet days ticked, extremes labelled", () => {
  const days = dailyBars(core);
  const { markup, model } = barsChart({ uid, title: "t", description: "d", days, width: 640 });
  const text = String(markup);
  assert.ok(!LEAKS.test(text), text.match(LEAKS)?.[0]);
  const bars = text.match(/class="bar (gain|loss)"/g) ?? [];
  assert.equal(bars.length, days.filter((d) => d.n > 0 && d.value !== 0).length);
  assert.equal((text.match(/class="quiet"/g) ?? []).length, days.filter((d) => d.n === 0).length);
  assert.ok((text.match(/class="bar-label"/g) ?? []).length <= 2, "never a number on every bar");
  assert.equal(model.count, days.length);
  assert.match(String(model.at(3).tip), /No closes/, "2026-10-10 had no closes");
  assert.match(model.at(3).speak, /No closes/);
});

test("bar paths round only the data end", () => {
  const up = barPath(10, 20, 16, 30, true);
  assert.match(up, /^M10 50V24Q10 20 14 20H22Q26 20 26 24V50Z$/);
  const down = barPath(10, 20, 16, 30, false);
  assert.match(down, /^M10 20H26V46Q26 50 22 50H14Q10 50 10 46Z$/);
  assert.equal(barPath(10, 20, 16, 0.4, true), "M10 20h16v0.4h-16Z", "a sliver stays a plain rectangle");
});

test("hours: the bars add up to the trades and the tooltip names the hour", () => {
  const hours = core.reports["M9-B-CHERRY"].hours;
  const { markup, model } = hoursChart({ uid, title: "t", description: "d", buckets: hours.buckets, width: 520, slot: 1 });
  const text = String(markup);
  assert.ok(!LEAKS.test(text), text.match(LEAKS)?.[0]);
  assert.equal(model.count, 24);
  assert.match(String(model.at(8).tip), /08:00–09:00/);
  assert.match(String(model.at(23).tip), /23:00–00:00/);
  assert.match(String(hoursChart({ uid, title: "t", description: "d", buckets: [{ h: "00:00", n: 0 }], width: 400 }).markup), /No trades/);
});

test("sparklines and chart tables", () => {
  assert.ok(!LEAKS.test(String(sparkline({ values: [0, 4, -2, 7], slot: 3 }))));
  assert.match(String(sparkline({ values: [3], slot: 1 })), /<svg/);
  const table = String(chartTable({ caption: "Daily result", columns: [{ label: "Day", cell: (row) => row.date }, { label: "Net", align: "right", cell: (row) => row.value }], rows: [{ date: "2026-10-07", value: "<1>" }] }));
  assert.match(table, /<caption class="sr-only">Daily result<\/caption>/);
  assert.match(table, /&lt;1&gt;/);
  assert.match(table, /scope="col" class="right">Net/);
});
