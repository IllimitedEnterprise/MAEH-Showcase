import test from "node:test";
import assert from "node:assert/strict";
import { PROBE, findChrome, withBrowser } from "./helpers/chrome.mjs";
import { createSiteServer } from "../scripts/lib/site.mjs";
import { REPO } from "./helpers/site-data.mjs";

/* The real-browser checks. The page is drawn by Chrome or Edge, at many widths, in both themes, and
 * poked the way a visitor would: layout that overlaps or overflows, a console message, a failed
 * request, a broken verifier, a flaky host. They only run when asked for (MAEH_BROWSER_TESTS=1) and a
 * browser is installed, so `node --test` stays instant and dependency-free. CI turns them on once. */

const browser = findChrome();
const skip = process.env.MAEH_BROWSER_TESTS === "1" && browser ? false : "set MAEH_BROWSER_TESTS=1 with Chrome or Edge installed to run the real-browser checks";

async function serving(run) {
  const server = createSiteServer({ root: REPO, base: "/MAEH-Showcase/", build: "test", commit: "0123456789abcdef0123456789abcdef01234567" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}/MAEH-Showcase`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const ROUTES = ["#/", "#/calendar", "#/day/2026-10-22", "#/account/M9-B-D.CHERRY", "#/stars/week", "#/integrity"];

async function matrix(origin, { widths, routes, theme }) {
  const problems = [];
  await withBrowser(async (page) => {
    await page.theme(theme);
    for (const width of widths) {
      await page.emulate(width);
      for (const route of routes) {
        const { issues } = await page.visit(`${origin}/${route}`);
        const data = JSON.parse(await page.evaluate(PROBE));
        const where = `${theme} ${width}px ${route}`;
        if (data.scrollW > data.vw + 1) problems.push(`${where}: the page scrolls sideways (${data.scrollW} > ${data.vw})`);
        if (data.past.length) problems.push(`${where}: past the window: ${data.past.join(", ")}`);
        if (data.selfOverflow.length) problems.push(`${where}: a box overflows itself: ${data.selfOverflow.join(", ")}`);
        if (data.hero && !data.hero.fits) problems.push(`${where}: the hero figure runs past its column (${data.hero.right} > ${data.hero.column})`);
        if (data.errorCard) problems.push(`${where}: the page shows its error card`);
        for (const issue of issues) problems.push(`${where}: ${issue}`);
      }
    }
  });
  return problems;
}

test("dark theme: no overflow, overlap, console message or failed request at any width", { skip, timeout: 600_000 }, async () => {
  await serving(async (origin) => {
    const problems = await matrix(origin, { widths: [390, 600, 768, 900, 960, 1024, 1100, 1280, 1440], routes: ROUTES, theme: "dark" });
    assert.deepEqual(problems, []);
  });
});

test("light theme: the same, at the widths where the layout changes", { skip, timeout: 600_000 }, async () => {
  await serving(async (origin) => {
    const problems = await matrix(origin, { widths: [390, 900, 1100, 1440], routes: ["#/", "#/day/2026-10-22", "#/account/M9-L-Mix", "#/integrity"], theme: "light" });
    assert.deepEqual(problems, []);
  });
});

test("the page recovers from one failed script, and gives up cleanly from a permanent one", { skip, timeout: 300_000 }, async () => {
  await serving(async (origin) => {
    const outcome = {};
    for (const [mode, times, wait] of [["once", 1, 5000], ["always", Infinity, 9000], ["never", 0, 3000]]) {
      await withBrowser(async (page) => {
        await page.emulate(1280);
        const watcher = await page.failRequests("*/js/views/day.mjs*", times);
        await page.send("Page.navigate", { url: `${origin}/#/` });
        await new Promise((resolve) => setTimeout(resolve, wait));
        const state = JSON.parse(await page.evaluate(`JSON.stringify({ h1: document.querySelector('h1')?.textContent ?? null, message: document.getElementById('view').textContent.includes('could not load its scripts'), tries: sessionStorage.getItem('maeh-showcase-boot-tries') })`));
        outcome[mode] = { ...state, loads: page.navigations(), requests: watcher.hits() };
      });
    }
    assert.deepEqual(outcome.never, { h1: "The desk so far", message: false, tries: "0", loads: 1, requests: 1 }, "no failure: one load");
    assert.equal(outcome.once.h1, "The desk so far", "one 503: the visitor ends up on the page");
    assert.equal(outcome.once.loads, 2, "after one automatic reload");
    assert.deepEqual({ h1: outcome.always.h1, message: outcome.always.message, loads: outcome.always.loads }, { h1: null, message: true, loads: 3 }, "a permanent 503: three loads, then a plain message and no loop");
  });
});

test("the verifiers, deep links, keyboard stepping and the theme switch work in a real browser", { skip, timeout: 300_000 }, async () => {
  await serving(async (origin) => {
    await withBrowser(async (page) => {
      await page.emulate(1280);
      await page.visit(`${origin}/#/integrity`);
      const chain = await page.evaluate(`(async () => { document.querySelector('[data-action="verify-chain"]').click(); for (let i = 0; i < 120; i++) { await new Promise(r => setTimeout(r, 250)); const t = document.querySelector('#chain-result .verify-ok, #chain-result .verify-bad'); if (t) return t.textContent.trim(); } return 'timed out'; })()`);
      assert.match(chain, /^All 16 days check out/);
      assert.equal(await page.evaluate("document.querySelectorAll('#chain-result tbody tr').length"), 16);

      await page.visit(`${origin}/#/day/2026-10-22`);
      const files = await page.evaluate(`(async () => { document.querySelector('[data-action="verify-day"]').click(); for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 250)); const t = document.querySelector('#verify-result'); if (t && /files match|do not match|Could not/.test(t.textContent)) return t.textContent.trim(); } return 'timed out'; })()`);
      assert.match(files, /^All 44 files match their recorded SHA-256/);

      await page.visit(`${origin}/#/day/2026-10-22/file/accounts/M9-B-CHERRY/trades.json`);
      assert.deepEqual(JSON.parse(await page.evaluate(`JSON.stringify({ file: document.querySelector('.viewer-title code')?.textContent, badge: document.querySelector('.viewer .badge')?.textContent.trim(), rows: document.querySelectorAll('.viewer-visual tbody tr').length })`)), { file: "accounts/M9-B-CHERRY/trades.json", badge: "Matches the manifest", rows: 61 });

      await page.visit(`${origin}/#/`);
      const keys = JSON.parse(await page.evaluate(`(async () => {
        const box = document.querySelector('#desk-curve-box'); box.focus(); await new Promise(r => setTimeout(r, 150));
        const tip = () => { const t = document.querySelector('.tip'); return t && !t.hidden ? t.textContent.replace(/\\s+/g, ' ').trim() : null; };
        const press = async (key) => { box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 120)); return tip(); };
        const home = await press('Home'); const end = await press('End'); const left = await press('ArrowLeft'); const esc = await press('Escape');
        return JSON.stringify({ home, end, left, esc, table: !!document.querySelector('#desk-curve-table table') });
      })()`));
      assert.match(keys.home, /^Wednesday 7 October 2026/);
      assert.match(keys.end, /^Thursday 22 October 2026/);
      assert.match(keys.left, /^Wednesday 21 October 2026/);
      assert.equal(keys.esc, null, "Escape hides the tooltip");
      assert.equal(keys.table, true, "every chart has a table twin");

      const theme = JSON.parse(await page.evaluate(`(async () => { const before = document.documentElement.dataset.theme; document.querySelector('[data-action="toggle-theme"]').click(); await new Promise(r => setTimeout(r, 150)); return JSON.stringify({ before, after: document.documentElement.dataset.theme, stored: localStorage.getItem('maeh-showcase-theme') }); })()`));
      assert.deepEqual(theme, { before: "dark", after: "light", stored: "light" });
      await page.send("Page.reload");
      await page.waitFor("!!document.querySelector('#view .page')");
      assert.equal(await page.evaluate("document.documentElement.dataset.theme"), "light", "the choice is remembered");
    });
  });
});
