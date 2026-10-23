import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "./helpers/site-data.mjs";

/* Static guards on everything the browser will run: the page is held to a strict
 * Content-Security-Policy, and these tests keep the code inside it. */

const SITE = join(REPO, "site");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(SITE).map((full) => ({ full, rel: relative(SITE, full).replaceAll("\\", "/") }));
const code = files.filter((file) => /\.(mjs|js)$/.test(file.rel));
const styles = files.filter((file) => file.rel.endsWith(".css"));
const read = (file) => readFileSync(file.full, "utf8");

test("the policy in the page forbids inline code, remote loading and framing tricks", () => {
  const html = readFileSync(join(SITE, "index.html"), "utf8");
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.ok(policy, "a policy is present");
  const directives = Object.fromEntries(policy.split(";").map((part) => part.trim().split(/\s+/)).filter((p) => p[0]).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives["default-src"], ["'none'"]);
  for (const name of ["script-src", "style-src", "font-src", "connect-src"]) assert.deepEqual(directives[name], ["'self'"], name);
  assert.deepEqual(directives["img-src"], ["'self'", "data:"]);
  assert.deepEqual(directives["base-uri"], ["'none'"]);
  assert.deepEqual(directives["form-action"], ["'none'"]);
  assert.ok(!/unsafe-inline|unsafe-eval|\*|https?:/.test(policy), "no wildcard, no remote origin, no unsafe keyword");
});

test("no script builds code from text, writes raw documents, or reaches off the page", () => {
  const forbidden = [
    [/\beval\s*\(/, "eval"],
    [/new\s+Function\s*\(/, "Function constructor"],
    [/document\.write/, "document.write"],
    [/insertAdjacentHTML/, "insertAdjacentHTML"],
    [/\bsetTimeout\s*\(\s*["'`]/, "setTimeout with a string"],
    [/\bsetInterval\s*\(\s*["'`]/, "setInterval with a string"],
    [/javascript:/i, "javascript: url"],
    [/XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|serviceWorker/, "network or worker API"],
    [/window\.open|location\.assign|location\.replace/, "navigation by script"],
    [/https?:\/\/(?=[a-z0-9])(?!github\.com\/IllimitedEnterprise\/MAEH-Showcase|127\.0\.0\.1|localhost)/i, "a remote URL"],
  ];
  const problems = [];
  for (const file of code) for (const [pattern, label] of forbidden) if (pattern.test(read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))) problems.push(`${file.rel}: ${label}`);
  assert.deepEqual(problems, []);
});

test("innerHTML is assigned in exactly the places that escape what they insert", () => {
  const allowed = new Set(["js/lib/dom.mjs", "js/charts/interact.mjs"]);
  const using = code.filter((file) => /\.innerHTML\s*=/.test(read(file))).map((file) => file.rel).sort();
  assert.deepEqual(using, [...allowed].sort(), "markup reaches the page only through mount() and the chart layer");
});

test("fetch, storage and the clipboard stay in the one module that owns each", () => {
  const owners = { "fetch(": ["js/lib/data.mjs"], "localStorage": ["js/lib/theme.mjs", "theme-boot.js"], "navigator.clipboard": ["js/lib/dom.mjs"], "crypto.subtle": ["js/lib/data.mjs"] };
  for (const [needle, owning] of Object.entries(owners)) {
    const found = code.filter((file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").includes(needle)).map((file) => file.rel).sort();
    assert.deepEqual(found, [...owning].sort(), `${needle} appears only in ${owning.join(", ")}`);
  }
});

test("the boot script can only reload a bounded number of times, and builds its message with the DOM", () => {
  const boot = read(files.find((file) => file.rel === "boot.js"));
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(boot), "the failure message is built with createElement and textContent");
  assert.match(boot, /count >= 0 && count < 2/, "at most two automatic reloads");
  assert.match(boot, /sessionStorage/, "the count survives a reload, so there is no loop");
  assert.match(boot, /return -1;[^}]*blocked/s, "with storage blocked there are no automatic reloads at all");
  assert.equal((boot.match(/location\.reload\(\)/g) ?? []).length, 2, "one automatic retry and the Reload button");
});

test("the stylesheets load nothing from outside and set no inline-only features", () => {
  for (const file of styles) {
    const text = read(file);
    assert.ok(!/@import/.test(text), `${file.rel} has no @import`);
    assert.ok(!/url\(\s*["']?(https?:|\/\/)/.test(text), `${file.rel} has no remote url()`);
    for (const [, target] of text.matchAll(/url\(\s*["']?([^"')]+)/g)) assert.ok(!target.startsWith("data:") || target.startsWith("data:image/"), `${file.rel}: ${target}`);
  }
});

test("every file the page references exists, and nothing in site/ is left unused", () => {
  const html = readFileSync(join(SITE, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="((?!#|https?:)[^"]+)"/g)].map((m) => m[1].split("?")[0]);
  for (const ref of refs) assert.ok(files.some((file) => file.rel === ref), `index.html references ${ref}`);
  const css = styles.map(read).join("\n");
  for (const [, target] of css.matchAll(/url\("\.\.\/([^"]+)"\)/g)) assert.ok(files.some((file) => file.rel === target), `a stylesheet references ${target}`);
});

test("every module imported by the code exists and no import leaves site/", () => {
  for (const file of code.filter((f) => f.rel.endsWith(".mjs"))) {
    for (const [, spec] of read(file).matchAll(/from\s+"([^"]+)"/g)) {
      assert.ok(spec.startsWith("."), `${file.rel} imports a bare or remote module ${spec}`);
      const target = join(file.full, "..", spec);
      assert.ok(target.startsWith(SITE), `${file.rel} imports outside site/: ${spec}`);
      assert.ok(files.some((f) => f.full === target), `${file.rel} imports missing ${spec}`);
    }
  }
});

test("class names the views use that no stylesheet defines are caught", () => {
  const css = styles.map(read).join("\n");
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const used = new Set();
  for (const file of code.filter((f) => f.rel.startsWith("js/"))) {
    for (const [, value] of read(file).matchAll(/class="([^"$]*)/g)) for (const name of value.split(/\s+/)) if (/^[a-z][\w-]*$/.test(name)) used.add(name);
  }
  /* structural wrappers and hooks that need no rule of their own */
  const hooks = new Set(["page", "season", "calendar", "day", "account", "stars", "integrity", "kind-markdown", "kind-json", "kind-csv", "kind-text", "tone-gain", "tone-loss", "tone-flat", "tone-none", "left", "right", "state-leading", "state-crowned", "state-no-star", "is-active", "line-ink", "stroke-ent-x", "gain", "loss", "ink", "brand", "flat", "none", "ent-x", "account-title", "axis-x", "axis-y", "cal-pad", "card-titles", "files", "glass-strong", "meta-item", "tree-root", "viewer-raw", "viewer-titles", "wash"]);
  const missing = [...used].filter((name) => !name.endsWith("-") && !defined.has(name) && !hooks.has(name) && !/^(ent|stroke-ent|fill-ent|key-ent|bar-ent|tl|award|level|tone|kind|side)-/.test(name));
  assert.deepEqual(missing.sort(), [], "a class the views emit has no rule: style it or list it as a hook");
});
