import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REPO } from "./helpers/site-data.mjs";
import { join } from "node:path";

/* Colour checks over the real stylesheet: every text colour on every surface it can land on
 * (including the aurora behind the glass at its brightest), the series colours on the chart plate,
 * and the series palette itself, which must stay exactly the set that was run through the dataviz
 * validator. */

const css = readFileSync(join(REPO, "site", "css", "tokens.css"), "utf8");

function tokens(selectorStart) {
  const start = css.indexOf(selectorStart);
  assert.ok(start >= 0, `${selectorStart} not found`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const out = {};
  for (const [, name, value] of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const dark = tokens(':root,\n:root[data-theme="dark"]');
const light = { ...tokens(':root[data-theme="light"]') };

function parse(value) {
  if (value.startsWith("#")) return [...[1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)), 1];
  const match = /rgba?\(([^)]+)\)/.exec(value);
  assert.ok(match, `cannot read colour ${value}`);
  const [r, g, b, a = 1] = match[1].split(",").map(Number);
  return [r, g, b, a];
}

const over = (top, below) => {
  const [r, g, b, a] = top;
  return [0, 1, 2].map((i) => [r, g, b][i] * a + below[i] * (1 - a)).concat(1);
};

const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/* The page behind a card: the base colour, and each aurora wash at its very centre (its strongest).
 * The four washes sit in four different corners and fade out, so they never stack at full strength. */
function pages(theme) {
  const base = parse(theme.bg);
  const washes = ["aurora-a", "aurora-b", "aurora-c", "aurora-d"].map((name) => parse(theme[name]));
  return [base, ...washes.map((wash) => over(wash, base))];
}

function surfaces(theme, name) {
  const out = [];
  for (const page of pages(theme)) {
    out.push({ name: `${name} page`, color: page });
    out.push({ name: `${name} card`, color: over(parse(theme.glass), page) });
    out.push({ name: `${name} hero`, color: over(parse(theme["glass-strong"]), page) });
    out.push({ name: `${name} phone card`, color: over(parse(theme["glass-solid"]), page) });
  }
  out.push({ name: `${name} chart plate`, color: parse(theme["surface-chart"]) });
  out.push({ name: `${name} tooltip`, color: parse(theme["surface-2"]) });
  out.push({ name: `${name} panel`, color: parse(theme.surface) });
  return out;
}

const TEXT = { ink: 7, "ink-2": 4.5, "ink-3": 4.5, link: 4.5, gain: 4.5, loss: 4.5, flat: 4.5, gold: 4.5, info: 4.5, warn: 4.5 };

/* Tokens defined once for both themes (the brand gradient); the dark block's selector includes :root. */
const GLOBAL = new Set(["brand-1", "brand-2", "brand-3", "brand-4", "brand-gradient"]);
for (const theme of [light]) for (const name of GLOBAL) theme[name] ??= dark[name];

for (const [themeName, theme] of [["dark", dark], ["light", light]]) {
  test(`${themeName}: every text colour reads on every surface it can land on`, () => {
    const problems = [];
    for (const surface of surfaces(theme, themeName)) {
      for (const [token, minimum] of Object.entries(TEXT)) {
        const value = ratio(parse(theme[token]), surface.color);
        if (value < minimum) problems.push(`${token} on ${surface.name}: ${value.toFixed(2)} < ${minimum}`);
      }
    }
    assert.deepEqual([...new Set(problems)], []);
  });

  test(`${themeName}: text over a tinted badge, the Star card and a heat cell`, () => {
    const problems = [];
    for (const page of pages(theme)) {
      const card = over(parse(theme.glass), page);
      const hero = over(parse(theme["glass-strong"]), page);
      const check = (label, fg, bg, minimum = 4.5) => { const value = ratio(fg, bg); if (value < minimum) problems.push(`${label}: ${value.toFixed(2)} < ${minimum}`); };
      for (const level of [1, 2, 3, 4]) {
        check(`ink on gain heat ${level}`, parse(theme.ink), over(parse(theme[`gain-${level}`]), card));
        check(`ink on loss heat ${level}`, parse(theme.ink), over(parse(theme[`loss-${level}`]), card));      }
      check("gain on its badge", parse(theme.gain), over(parse(theme["gain-1"]), card));
      check("loss on its badge", parse(theme.loss), over(parse(theme["loss-1"]), card));
      const starTint = theme === dark ? [255, 201, 77, 0.14] : [255, 201, 77, 0.3];
      check("gold on the Star card", parse(theme.gold), over(starTint, hero));
      check("ink-2 on the Star card", parse(theme["ink-2"]), over(starTint, hero));
      check("ink on the Star card", parse(theme.ink), over(starTint, hero));
    }
    assert.deepEqual([...new Set(problems)], []);
  });

  test(`${themeName}: marks meet 3:1 against the chart plate`, () => {
    const plate = parse(theme["surface-chart"]);
    const marks = ["ink", "gain", "loss", "flat", "brand-2", "ink-3"];
    const problems = marks.filter((token) => ratio(parse(theme[token]), plate) < 3).map((token) => `${token}: ${ratio(parse(theme[token]), plate).toFixed(2)}`);
    assert.deepEqual(problems, []);
  });
}

test("button and tab labels stay readable across the whole brand gradient", () => {
  const label = parse("#060716");
  for (const stop of ["brand-1", "brand-2", "brand-3"]) assert.ok(ratio(label, parse(dark[stop])) >= 4.5, stop);
});

/* The eight series colours, exactly as validated by the dataviz method's script. */
const VALIDATED = {
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
};

for (const [themeName, theme] of [["dark", dark], ["light", light]]) {
  test(`${themeName}: the series colours are the validated palette, unchanged and in order`, () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((i) => theme[`ent-${i}`]), VALIDATED[themeName]);
  });
}

test("dark series colours reach 3:1 on the chart plate; light ones that cannot are the three documented ones", () => {
  const darkPlate = parse(dark["surface-chart"]);
  for (let i = 1; i <= 8; i += 1) assert.ok(ratio(parse(dark[`ent-${i}`]), darkPlate) >= 3, `dark ent-${i}`);
  const lightPlate = parse(light["surface-chart"]);
  const below = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => ratio(parse(light[`ent-${i}`]), lightPlate) < 3);
  assert.deepEqual(below, [3, 4, 5], "aqua, yellow and magenta are below 3:1 on the pale plate; every chart has a table twin and a legend as relief");
});

test("every token the stylesheets use is defined in both themes", () => {
  const used = new Set();
  for (const file of ["base.css", "components.css", "charts.css"]) {
    for (const [, name] of readFileSync(join(REPO, "site", "css", file), "utf8").matchAll(/var\(--([a-z0-9-]+)/g)) used.add(name);
  }
  const local = new Set(["ent", "w", "h"]);
  const shared = tokens(":root {\n  --font-ui");
  const missing = [...used].filter((name) => !local.has(name) && !(name in shared) && !(name in dark && name in light));
  assert.deepEqual(missing, [], "a colour token used by the stylesheets must exist in both themes");
  const onlyDark = Object.keys(dark).filter((name) => !(name in light) && !GLOBAL.has(name));
  assert.deepEqual(onlyDark, [], "a theme-specific token missing from the light theme would silently stay dark");
});
