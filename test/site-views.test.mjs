import test from "node:test";
import assert from "node:assert/strict";
import { createData, dayFile, loadCore, loadDay } from "../site/js/lib/data.mjs";
import { parseRoute } from "../site/js/lib/router.mjs";
import { accountKeys, dayEntry } from "../site/js/lib/model.mjs";
import { views } from "../site/js/views/index.mjs";
import { chainResultHtml } from "../site/js/views/integrity.mjs";
import { verifyChain, verifyDayFiles } from "../site/js/lib/data.mjs";
import { LEAKS, fsFetch } from "./helpers/site-data.mjs";
import { checkMarkup, externalLinks, hashLinks, withoutCode } from "./helpers/markup.mjs";

const data = createData({ fetchImpl: fsFetch(), build: "test" });
const core = await loadCore(data);
const manifests = new Map();
for (const day of core.index.days) manifests.set(day.date, await loadDay(data, day.date));

const ctx = (state = {}) => ({ data, core, state: { range: "all", isolated: null, ...state }, build: { build: "test", commit: "abc1234", builtAt: "2026-10-23T00:00:00Z", verified: true } });

async function draw(hash, state) {
  const route = parseRoute(hash);
  const view = views[route.name];
  const model = await view.load(ctx(state), route);
  const out = view.render(model, ctx(state));
  assert.equal(typeof out.title, "string");
  assert.ok(out.title.length > 0, `${hash} has a title`);
  assert.equal(typeof out.after, "function");
  return { route, markup: String(out.markup), out };
}

function audit(hash, markup) {
  const problems = checkMarkup(markup);
  assert.deepEqual(problems, [], `${hash}: ${problems.join("; ")}`);
  const scan = withoutCode(markup);
  const leak = scan.match(LEAKS);
  assert.equal(leak, null, `${hash} shows "${leak?.[0]}" near: ${leak ? scan.slice(Math.max(0, leak.index - 60), leak.index + 60) : ""}`);
  for (const link of hashLinks(markup)) {
    const route = parseRoute(link);
    assert.notEqual(route.name, "notfound", `${hash} links to ${link}, which is not a route`);
    if (route.name === "day") {
      assert.ok(dayEntry(core, route.date), `${hash} links to a day that is not frozen: ${link}`);
      if (route.file) assert.ok(route.file === "day.json" || Object.hasOwn(manifests.get(route.date).files, route.file), `${hash} links to a file the day does not have: ${link}`);
    }
    if (route.name === "account") assert.ok(core.reports[route.key], `${hash} links to an unknown account ${link}`);
  }
  for (const link of externalLinks(markup)) assert.match(link, /^https:\/\/github\.com\/IllimitedEnterprise\/MAEH-Showcase/, `${hash} links off-site to ${link}`);
}

test("the landing page draws, for every range and with a line isolated", async () => {
  for (const range of ["all", "30", "7"]) {
    const { markup } = await draw("#/", { range });
    audit(`#/ (range ${range})`, markup);
  }
  const { markup } = await draw("#/", { isolated: "M9-S-B" });
  audit("#/ (isolated)", markup);
  assert.match(markup, /aria-pressed="true"/);
  assert.equal((markup.match(/data-action="isolate"/g) ?? []).length, 8);
});

test("the landing page tells the truth about the season", async () => {
  const { markup } = await draw("#/");
  assert.match(markup, /The desk so far/);
  assert.match(markup, /Star of the day/);
  assert.match(markup, /M9-L-Mix/);
  assert.equal((markup.match(/class="acct ent-\d"/g) ?? []).length, 8, "one card per account, each in its own colour");
  assert.equal((markup.match(/class="day-tile /g) ?? []).length, 14);
});

test("the calendar draws every month it can be asked for", async () => {
  for (const hash of ["#/calendar", "#/calendar/2026-10", "#/calendar/2026-09", "#/calendar/2026-11", "#/calendar/2027-02"]) {
    const { markup } = await draw(hash);
    audit(hash, markup);
  }
  const { markup } = await draw("#/calendar/2026-10");
  assert.equal((markup.match(/class="cal-cell tone-/g) ?? []).length, 16, "one link per frozen day");
  assert.match(markup, /aria-label="Thursday 22 October 2026: \+8173\.58, 224 closes, Star M9-L-Mix"/);
  assert.match(markup, /aria-label="Saturday 10 October 2026: no closes"/);
  const empty = (await draw("#/calendar/2026-09")).markup;
  assert.match(empty, /No days were frozen in this month/);
});

test("every frozen day draws, with its default file", async () => {
  for (const day of core.index.days) {
    const hash = `#/day/${day.date}`;
    const { markup } = await draw(hash);
    audit(hash, markup);
    assert.match(markup, /Matches the manifest/, `${hash}: the README matches its recorded hash`);
  }
});

test("every file of every frozen day opens in the viewer, matches its manifest, and draws cleanly", async () => {
  let opened = 0;
  for (const day of core.index.days) {
    const manifest = manifests.get(day.date);
    for (const rel of ["day.json", ...Object.keys(manifest.files)]) {
      const hash = `#/day/${day.date}/file/${rel}`;
      const { markup } = await draw(hash);
      audit(hash, markup);
      assert.match(markup, /Matches the manifest/, `${hash} matches its recorded hash`);
      assert.ok(!/Does not match/.test(markup), hash);
      opened += 1;
    }
  }
  const expected = [...manifests.values()].reduce((sum, manifest) => sum + Object.keys(manifest.files).length + 1, 0);
  assert.equal(opened, expected, "every file of every day, plus each day.json");
});

test("the readable form exists for every kind of file, and the raw form for all", async () => {
  const checks = {
    "README.md": /class="prose"/,
    "day.json": /Files and their SHA-256/,
    "desk.json": /When the trades were opened/,
    "stars.json": /class="table standings"/,
    "accounts/M9-B-CHERRY/summary.json": /Deepest fall/,
    "accounts/M9-B-CHERRY/summary.md": /class="prose"/,
    "accounts/M9-B-CHERRY/trades.json": /Closed trades/,
    "accounts/M9-B-CHERRY/trades.csv": /Closed trades/,
    "accounts/M9-B-CHERRY/hours.json": /id="fv-hours-box"/,
  };
  for (const [rel, pattern] of Object.entries(checks)) {
    const { markup } = await draw(`#/day/2026-10-22/file/${rel}`);
    assert.match(markup, pattern, rel);
    assert.match(markup, /data-panel="raw"/, `${rel} keeps the raw bytes`);
    assert.match(markup, /class="code"/);
  }
});

test("a trade file shows symbol, side, net and R but no time of any kind", async () => {
  const { markup } = await draw("#/day/2026-10-22/file/accounts/M9-S-B/trades.json");
  assert.match(markup, /XAGUSD/);
  assert.match(markup, /Short/);
  assert.match(markup, /\+1,004\.60/);
  assert.match(markup, /\+0\.54/);
  assert.ok(!/\b\d{2}:\d{2}:\d{2}\b/.test(markup), "no clock time appears on a trade page");
});

test("a raw file is escaped, never executed", async () => {
  const { markup } = await draw("#/day/2026-10-22/file/accounts/M9-S-B/trades.json");
  assert.match(markup, /<span class="tk-key">&quot;symbol&quot;<\/span>:/);
  assert.ok(!/<script/i.test(markup));
});

test("an unknown day or file is a page that says so, not a crash", async () => {
  const day = await draw("#/day/2026-12-01");
  assert.match(day.markup, /Nothing is frozen for this day/);
  audit("#/day/2026-12-01", day.markup);
  const file = await draw("#/day/2026-10-22/file/accounts/M9-B-CHERRY/secret.json");
  assert.match(file.markup, /No such file/);
  audit("missing file", file.markup);
});

test("every account page draws", async () => {
  for (const key of accountKeys(core)) {
    const hash = `#/account/${key}`;
    const { markup } = await draw(hash);
    audit(hash, markup);
    assert.match(markup, new RegExp(`<h1[^>]*>.*${key.replace(/\./g, "\\.")}`));
  }
  const missing = await draw("#/account/nobody");
  assert.match(missing.markup, /No such account/);
  audit("#/account/nobody", missing.markup);
});

test("the account page for an account funded late shows only the days it existed", async () => {
  const { markup } = await draw("#/account/M9-L-Mix");
  const formCard = markup.match(/id="acct-form-h"[\s\S]*?<\/section>/)[0];
  assert.equal((formCard.match(/<tr class="/g) ?? []).length, 2, "10-21 (no closes) and 10-22; the days before funding are not listed");
  assert.ok(!/Not funded yet/.test(markup));
  assert.match(markup, /funded Wed 21 Oct 2026/);
});

test("every Stars tab draws", async () => {
  for (const hash of ["#/stars", "#/stars/day", "#/stars/week", "#/stars/month", "#/stars/all"]) {
    const { markup } = await draw(hash);
    audit(hash, markup);
    assert.match(markup, /How the Star is scored/);
    assert.match(markup, /aria-current="page"/);
  }
  const week = (await draw("#/stars/week")).markup;
  assert.match(week, /Not yet crowned/, "an unfinished week shows a standing, not a crown");
  const all = (await draw("#/stars/all")).markup;
  assert.match(all, /Crown tally/);
  assert.match(all, /Every Star awarded/);
});

test("the integrity page draws, and its verifiers agree with the repository", async () => {
  const { markup } = await draw("#/integrity");
  audit("#/integrity", markup);
  assert.match(markup, new RegExp(core.index.tip.sha256));
  const chain = await verifyChain(data, core);
  assert.equal(chain.ok, true);
  assert.equal(chain.rows.length, core.index.days.length);
  audit("chain result", `<h1>x</h1>${chainResultHtml(chain)}`);
  assert.match(String(chainResultHtml(chain)), /All 16 days check out/);

  const entry = dayEntry(core, "2026-10-22");
  const progress = [];
  const outcome = await verifyDayFiles(data, "2026-10-22", manifests.get("2026-10-22"), entry, (done, total) => progress.push([done, total]));
  const files = Object.keys(manifests.get("2026-10-22").files).length + 1;
  assert.deepEqual({ total: outcome.total, ok: outcome.ok, failed: outcome.failed }, { total: files, ok: files, failed: [] });
  assert.equal(progress.at(-1)[0], files);
});

test("the verifiers catch a tampered file and a broken link", async () => {
  const tampered = createData({
    fetchImpl: async (url) => {
      const response = await fsFetch()(url);
      if (String(url).includes("2026-10-12/desk.json")) {
        const text = (await response.text()).replace('"net"', '"nett"');
        const buffer = Buffer.from(text, "utf8");
        return { ok: true, status: 200, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), text: async () => text, json: async () => JSON.parse(text) };
      }
      if (String(url).includes("2026-10-15/day.json")) {
        const text = (await response.text()).replace('"seq": 9', '"seq": 99');
        const buffer = Buffer.from(text, "utf8");
        return { ok: true, status: 200, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), text: async () => text, json: async () => JSON.parse(text) };
      }
      return response;
    },
  });
  const day = await verifyDayFiles(tampered, "2026-10-12", manifests.get("2026-10-12"), dayEntry(core, "2026-10-12"));
  assert.deepEqual(day.failed, ["desk.json"]);
  const chain = await verifyChain(tampered, core);
  assert.equal(chain.ok, false);
  const bad = chain.rows.filter((row) => !row.hashOk || !row.prevOk || row.note);
  assert.deepEqual(bad.map((row) => row.date), ["2026-10-15"], "the edited day is named");
  assert.match(String(chainResultHtml(chain)), /A problem was found/);
  assert.match(String(chainResultHtml(chain)), /First at 2026-10-15/);

  /* If the catalogue itself were edited, the day after no longer finds its link back. */
  const forged = structuredClone(core);
  forged.index.days[8].sha256 = "f".repeat(64);
  const relinked = await verifyChain(data, forged);
  assert.equal(relinked.ok, false);
  assert.deepEqual(relinked.rows.filter((row) => !row.hashOk || !row.prevOk).map((row) => [row.date, row.hashOk, row.prevOk]), [["2026-10-15", false, true], ["2026-10-16", true, false]]);

  /* A tip that does not match the last day is caught on its own. */
  const moved = structuredClone(core);
  moved.index.tip.sha256 = "0".repeat(64);
  assert.equal((await verifyChain(data, moved)).tipOk, false);
});

test("an unknown route is a friendly page", async () => {
  const { markup } = await draw("#/nope");
  assert.match(markup, /That address does not lead anywhere/);
  audit("#/nope", markup);
});

test("the shell page itself is clean", async () => {
  const { readFile } = await import("node:fs/promises");
  const shell = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
  assert.match(shell, /Content-Security-Policy/);
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(shell), "no inline script");
  assert.ok(!/\sstyle="/.test(shell) && !/<style/i.test(shell), "no inline style");
  assert.ok(!/https?:\/\/(?!github\.com\/IllimitedEnterprise)/.test(shell.replace(/xmlns="[^"]+"/g, "")), "no third-party URL in the shell");
  const ids = [...shell.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "ids in the shell are unique");
  for (const m of shell.matchAll(/<use href="#([^"]+)"/g)) assert.ok(ids.includes(m[1]), `sprite symbol ${m[1]} exists`);
  assert.equal(dayFile("2026-10-22", "x"), "results/2026/10/2026-10-22/x");
});
