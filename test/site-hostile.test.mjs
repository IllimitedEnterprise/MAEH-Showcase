import test from "node:test";
import assert from "node:assert/strict";
import { createData, loadCore, loadDay } from "../site/js/lib/data.mjs";
import { parseRoute } from "../site/js/lib/router.mjs";
import { accountKeys } from "../site/js/lib/model.mjs";
import { views } from "../site/js/views/index.mjs";
import { barsChart, curveChart, hoursChart } from "../site/js/charts/draw.mjs";
import { fsFetch } from "./helpers/site-data.mjs";
import { checkMarkup } from "./helpers/markup.mjs";

/* The data files are untrusted text as far as the page is concerned: an account label or a symbol
 * comes from a trading terminal, and a Markdown file could say anything. This serves the real files
 * with hostile strings swapped into every place that reaches the screen, draws every route, and
 * checks that nothing came out as markup. */

const PAYLOAD = `"><img src=x onerror=alert(1)><script>alert(1)</script><iframe src="javascript:alert(1)"></iframe>'&amp;`;
const BAD_FIELDS = new Set(["label", "symbol", "side", "kind", "status", "zone", "currency", "rules", "source", "basis"]);
const BAD_LISTS = new Set(["reasons", "why"]);

function poison(node, parentKey = null) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => {
      if (typeof value === "string" && BAD_LISTS.has(parentKey)) node[index] = PAYLOAD;
      else poison(value, parentKey);
    });
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && BAD_FIELDS.has(key)) node[key] = PAYLOAD;
      else poison(value, key);
    }
  }
}

function hostileFetch() {
  const real = fsFetch();
  return async (url) => {
    const response = await real(url);
    if (!response.ok) return response;
    const clean = String(url).split("?")[0];
    let text = await response.text();
    if (clean.endsWith(".md")) {
      text += `\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) ![i](https://evil.example/x.png) <img src=x onerror=alert(1)> [y](https://evil.example/"onmouseover="alert(1))\n\n| ${PAYLOAD} |\n|---|\n| ${PAYLOAD} |\n`;
    } else if (clean.endsWith(".csv")) {
      text = text.replace(/,([A-Z][A-Z0-9]{2,}),/g, `,${PAYLOAD.replace(/,/g, ";")},`);
    } else if (clean.endsWith(".json") && !clean.endsWith("day.json")) {
      const data = JSON.parse(text);
      poison(data);
      text = `${JSON.stringify(data, null, 2)}\n`;
    }
    const buffer = Buffer.from(text, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  };
}

const data = createData({ fetchImpl: hostileFetch(), build: "x" });
const core = await loadCore(data);
const ctx = { data, core, state: { range: "all", isolated: null }, build: null };

async function draw(hash) {
  const route = parseRoute(hash);
  const view = views[route.name];
  const out = view.render(await view.load(ctx, route), ctx);
  return String(out.markup);
}

/* Every real tag in the markup, with its attributes split into names and values. The page escapes
 * `<`, `>` and quotes in anything it interpolates, so a tag ends at the first `>` and a value at the
 * next quote; text that merely *says* `onerror=` inside a value or outside a tag is not an attribute. */
function tagsOf(markup) {
  return [...markup.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g)].map((match) => {
    const attributes = [...match[2].matchAll(/\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((a) => ({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? "" }));
    return { name: match[1].toLowerCase(), attributes };
  });
}

/* Dangerous means: an element that can run or load something, or an attribute that can. Escaped text is fine. */
function dangerous(markup) {
  const found = [];
  const EMBEDS = new Set(["script", "iframe", "object", "embed", "link", "meta", "base", "form", "input", "img", "video", "audio", "source", "frame", "style"]);
  for (const tag of tagsOf(markup)) {
    if (EMBEDS.has(tag.name)) found.push(`an <${tag.name}> element`);
    for (const attribute of tag.attributes) {
      if (attribute.name.startsWith("on")) found.push(`an ${attribute.name} handler`);
      if (attribute.name === "style") found.push("an inline style");
      if (["href", "src", "action", "formaction", "xlink:href"].includes(attribute.name) && /^\s*(javascript|data|vbscript):/i.test(attribute.value)) found.push(`a script url in ${attribute.name}`);
    }
  }
  return found;
}

test("the poison reaches the page, but only ever as text", async () => {
  const season = await draw("#/");
  assert.match(season, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;/, "a hostile label is shown, escaped");
  assert.deepEqual(dangerous(season), []);
});

test("every page, drawn from hostile data, contains nothing that can run", async () => {
  const hashes = ["#/", "#/calendar", "#/calendar/2026-10", "#/stars", "#/stars/week", "#/stars/month", "#/stars/all", "#/integrity", "#/day/2026-10-22", "#/day/2026-10-10", "#/day/2026-10-21"];
  for (const key of accountKeys(core)) hashes.push(`#/account/${key}`);
  const manifest = await loadDay(data, "2026-10-22");
  for (const rel of ["day.json", ...Object.keys(manifest.files)]) hashes.push(`#/day/2026-10-22/file/${rel}`);
  for (const hash of hashes) {
    const markup = await draw(hash);
    assert.deepEqual(dangerous(markup), [], hash);
    const problems = checkMarkup(markup).filter((problem) => !/javascript: url/.test(problem));
    assert.deepEqual(problems, [], `${hash}: ${problems.join("; ")}`);
  }
});

test("a hostile file shows its text, never its markup, in the raw viewer and the readable one", async () => {
  const readme = await draw("#/day/2026-10-22");
  assert.match(readme, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!/<a [^>]*href="javascript:/i.test(readme), "an unsafe Markdown link loses its target");
  assert.ok(!/<img /i.test(readme.replace(/<svg[\s\S]*?<\/svg>/g, "")), "no image element from Markdown");
  const raw = await draw("#/day/2026-10-22/file/accounts/M9-B-CHERRY/summary.json");
  assert.match(raw, /class="code"/);
  assert.deepEqual(dangerous(raw), []);
});

test("charts built from hostile labels keep them as text", () => {
  const series = [{ key: PAYLOAD, label: PAYLOAD, slot: 1, points: [{ date: "2026-10-07", value: 5 }, { date: "2026-10-08", value: -3 }] }];
  const curve = curveChart({ uid: "h1", title: PAYLOAD, description: PAYLOAD, series, width: 600 });
  const tip = String(curve.model.at(1).tip);
  const bars = barsChart({ uid: "h2", title: PAYLOAD, description: PAYLOAD, days: [{ date: "2026-10-07", value: 3, n: 1 }], width: 600 });
  const hours = hoursChart({ uid: "h3", title: PAYLOAD, description: PAYLOAD, buckets: [{ h: "09:00", n: 2 }, { h: PAYLOAD, n: 1 }], width: 600 });
  for (const markup of [String(curve.markup), tip, String(bars.markup), String(hours.markup)]) assert.deepEqual(dangerous(markup), []);
  assert.match(tip, /&lt;img/);
});

test("a route cannot be bent into fetching anything outside the day's own files", async () => {
  const fetched = [];
  const spy = createData({ fetchImpl: async (url) => { fetched.push(String(url)); return hostileFetch()(url); }, build: "x" });
  const spyCore = await loadCore(spy);
  const probe = { data: spy, core: spyCore, state: {}, build: null };
  for (const hash of ["#/day/2026-10-22/file/../../../package.json", "#/day/2026-10-22/file/accounts/..%2F..%2Fconfig/season.json", "#/day/2026-10-22/file/accounts/M9-B-CHERRY/../../../../stars/RULES.md", "#/day/2026-10-22/file/__proto__", "#/day/2026-10-22/file/constructor", "#/account/..", "#/account/__proto__"]) {
    const route = parseRoute(hash);
    if (route.name === "notfound") continue;
    const view = views[route.name];
    fetched.length = 0;
    const out = view.render(await view.load(probe, route), probe);
    const outside = fetched.filter((url) => !/results\/2026\/10\/2026-10-22\/(day|desk|stars)\.json/.test(url));
    assert.deepEqual(outside, [], `${hash} fetched ${outside.join(", ")}`);
    assert.ok(String(out.markup).length > 0);
  }
});
