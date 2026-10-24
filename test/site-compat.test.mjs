import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "./helpers/site-data.mjs";

/* The real-browser tests drive Chrome and Edge, so Firefox and Safari are never run here. What can be kept honest
 * without them is the floor the site's own code asks of a browser: nothing newer than Safari 15.4 (March 2022) and
 * Firefox 92, except progressive enhancements that are guarded and fall back. This reads the source and refuses
 * the features that would raise that floor. It cannot prove a page works in a browser nobody has run it in. */

const SITE = join(REPO, "site");
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const files = walk(SITE).filter((file) => /\.(mjs|js|css|html)$/.test(file));
const sources = files.map((file) => ({ rel: relative(SITE, file).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }));
const script = sources.filter((s) => /\.(mjs|js|html)$/.test(s.rel));
const styles = sources.filter((s) => s.rel.endsWith(".css"));

/* feature, where it would appear, what it would need */
const TOO_NEW = [
  ["a regular-expression lookbehind", /\(\?<[=!]/, "Safari 16.4"],
  ["toSorted, toReversed or toSpliced", /\.(toSorted|toReversed|toSpliced)\(/, "Safari 16 and Firefox 115"],
  ["Object.groupBy, Map.groupBy or Promise.withResolvers", /\b(Object|Map)\.groupBy\(|Promise\.withResolvers\(/, "Safari 17.4"],
  ["AbortSignal.timeout", /AbortSignal\.timeout\(/, "Safari 16"],
  ["Array.fromAsync", /Array\.fromAsync\(/, "Safari 16.4"],
];
const TOO_NEW_CSS = [
  [":has()", /:has\(/, "Firefox 121"],
  ["color-mix()", /color-mix\(/, "Safari 16.2 and Firefox 113"],
  ["@layer", /@layer\b/, "Safari 15.4 (allowed) but not in use; add it here when it is"],
  ["CSS nesting", /^\s*&\s*[.:#\[>+~ ]/m, "Safari 17.2 and Firefox 117"],
  ["oklch(), oklab(), lab() or lch()", /\b(oklch|oklab|lab|lch)\(/, "Safari 15.4 and Firefox 113"],
  ["@property", /@property\b/, "Safari 16.4 and Firefox 128"],
  ["subgrid", /subgrid/, "Safari 16"],
];

test("the site's scripts use nothing newer than Safari 15.4 and Firefox 92 asks for", () => {
  const problems = [];
  for (const [label, pattern, needs] of TOO_NEW) {
    for (const { rel, text } of script) if (rel !== "index.html" && pattern.test(text)) problems.push(`${rel} uses ${label} (needs ${needs})`);
  }
  assert.deepEqual(problems, []);
});

test("the site's styles use nothing newer than that floor, apart from guarded enhancements", () => {
  const problems = [];
  for (const [label, pattern, needs] of TOO_NEW_CSS) {
    if (label === "@layer") continue;
    for (const { rel, text } of styles) if (pattern.test(text)) problems.push(`${rel} uses ${label} (needs ${needs})`);
  }
  assert.deepEqual(problems, []);
});

test("container-query units appear only inside the @supports block that guards them", () => {
  for (const { rel, text } of styles) {
    const guarded = [];
    for (const match of text.matchAll(/@supports\s*\(font-size:\s*1cqw\)\s*\{/g)) {
      let depth = 1;
      let index = match.index + match[0].length;
      while (depth > 0 && index < text.length) {
        if (text[index] === "{") depth += 1;
        if (text[index] === "}") depth -= 1;
        index += 1;
      }
      guarded.push([match.index, index]);
    }
    for (const unit of text.matchAll(/\d(cqw|cqi|cqh|cqb|cqmin|cqmax)\b/g)) {
      const inside = guarded.some(([start, end]) => unit.index > start && unit.index < end);
      assert.ok(inside, `${rel}: ${unit[0]} at offset ${unit.index} is outside an @supports (font-size: 1cqw) block, so a browser without container units would drop the whole declaration`);
    }
  }
});

test("a viewport-height unit that is new (dvh, svh, lvh) always has a plain vh declaration just before it", () => {
  for (const { rel, text } of styles) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const match = /([a-z-]+)\s*:\s*[^;]*\d(dvh|svh|lvh)\b/.exec(line);
      if (!match) return;
      const property = match[1];
      const before = lines.slice(Math.max(0, index - 3), index).join("\n");
      assert.match(before, new RegExp(`${property}\\s*:\\s*[^;]*\\dvh\\b`), `${rel}:${index + 1} sets ${property} in ${match[2]} with no vh fallback before it`);
    });
  }
});

test("every backdrop-filter has its -webkit- twin, because Safari needs the prefix, and the glass has a solid fallback", () => {
  for (const { rel, text } of styles) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (!/(^|[;{\s])backdrop-filter\s*:/.test(line)) return;
      const nearby = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
      assert.match(nearby, /-webkit-backdrop-filter\s*:/, `${rel}:${index + 1} has backdrop-filter without -webkit-backdrop-filter`);
    });
  }
  const all = styles.map((s) => s.text).join("\n");
  assert.match(all, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/, "a browser without backdrop-filter gets solid cards");
});
