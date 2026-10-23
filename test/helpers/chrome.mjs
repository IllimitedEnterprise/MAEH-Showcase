/* A small driver for a real Chromium-based browser (Chrome or Edge), speaking the DevTools Protocol
 * over the WebSocket that Node 22 provides. No dependency: it launches the browser headless with a
 * throwaway profile, none of this process's secrets in its environment, and closes it again. Used by
 * the real-browser checks, which only run when asked for and a browser is installed. */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome(env = process.env, platform = process.platform) {
  const candidates = [];
  if (env.MAEH_CHROME) candidates.push(env.MAEH_CHROME);
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
      if (base) candidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"), join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    for (const dir of String(env.PATH ?? "").split(delimiter)) {
      for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) candidates.push(join(dir, name));
    }
  }
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

const SECRETISH = /TOKEN|SECRET|KEY|PASSWORD|CLAUDE|AUTH/i;
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !SECRETISH.test(name)));

/* Everything the layout probe asks a page, as one expression, so tests and humans ask the same thing. */
export const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { scrollW: document.documentElement.scrollWidth, vw, past: [], selfOverflow: [], hero: null, errorCard: !!document.querySelector('.empty-error') };
  const skip = (el) => el.closest('.table-wrap, .code, .tree, svg, .chart-box, .files-side, .tip, .cal-wrap');
  for (const el of document.querySelectorAll('#view *')) {
    if (skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) out.past.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 24) + ' ' + Math.round(r.left) + '>' + Math.round(r.right));
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline' && cs.overflowX === 'visible' && el.clientWidth > 0 && !['TD', 'TH', 'TR', 'TABLE', 'TBODY', 'THEAD', 'A', 'BUTTON'].includes(el.tagName)) out.selfOverflow.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 24) + ' ' + el.scrollWidth + '>' + el.clientWidth);
  }
  const fig = document.querySelector('.hero-figure'), main = document.querySelector('.hero-main');
  if (fig && main) { const m = fig.querySelector('.money') || fig, a = m.getBoundingClientRect(), b = main.getBoundingClientRect(); out.hero = { right: Math.round(a.right), column: Math.round(b.right), fits: a.right <= b.right + 1 }; }
  out.past = out.past.slice(0, 5); out.selfOverflow = out.selfOverflow.slice(0, 5);
  return JSON.stringify(out);
})()`;

export async function withBrowser(run, { path = findChrome() } = {}) {
  if (!path) throw new Error("no Chrome or Edge found");
  const profile = mkdtempSync(join(tmpdir(), "maeh-browser-"));
  const flags = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"];
  if (process.env.CI) flags.unshift("--no-sandbox"); /* hosted runners run in a container; the browser only ever opens our own test server */
  const child = spawn(path, flags, { env: cleanEnv(), stdio: "ignore", windowsHide: true });
  try {
    let port = 0;
    for (let i = 0; i < 150 && !port; i += 1) {
      await sleep(100);
      const file = join(profile, "DevToolsActivePort");
      if (existsSync(file)) port = Number(readFileSync(file, "utf8").split(/\r?\n/)[0]);
    }
    if (!port) throw new Error("the browser did not open a debugging port");
    let target;
    for (let i = 0; i < 60 && !target; i += 1) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((entry) => entry.type === "page"); } catch { /* not ready yet */ }
      if (!target) await sleep(100);
    }
    if (!target) throw new Error("the browser opened no page");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const page = createPage(socket);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Network.enable");
    await page.send("Log.enable");
    try {
      return await run(page);
    } finally {
      try { await Promise.race([page.send("Browser.close"), sleep(2000)]); } catch { /* closing */ }
      socket.close();
    }
  } finally {
    const exited = await Promise.race([new Promise((resolve) => child.once("exit", () => resolve(true))), sleep(6000).then(() => false)]);
    if (!exited && child.pid) spawn(process.platform === "win32" ? "taskkill" : "kill", process.platform === "win32" ? ["/PID", String(child.pid), "/T", "/F"] : ["-9", String(child.pid)], { stdio: "ignore", windowsHide: true });
    await sleep(1000);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 400 }); } catch { /* a temp folder: the OS cleans it */ }
  }
}

function createPage(socket) {
  let id = 0;
  const pending = new Map();
  let events = [];
  let handler = null;
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
    events.push(data);
    if (handler) handler(data);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mine = ++id;
    pending.set(mine, (reply) => (reply.error ? reject(new Error(`${method}: ${reply.error.message}`)) : resolve(reply.result)));
    socket.send(JSON.stringify({ id: mine, method, params }));
  });
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  };
  let themeScript = null;
  return {
    send,
    evaluate,
    async emulate(width, height = 900, mobile = width < 600) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    },
    async theme(name) {
      if (themeScript) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: themeScript });
      themeScript = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem('maeh-showcase-theme', '${name}'); } catch (e) {}` })).identifier;
    },
    /* Poll until `expression` is truthy, or say why not. */
    async waitFor(expression, { timeout = 15000, label = expression } = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await evaluate(expression)) return true; } catch { /* the page is between documents */ }
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${label}`);
    },
    /* A fresh document each time, and what the console and the network did while it loaded. */
    async visit(url, { ready = "!!document.querySelector('#view .page, #view .empty')", settle = 600 } = {}) {
      await send("Page.navigate", { url: "about:blank" });
      await sleep(120);
      events = [];
      await send("Page.navigate", { url });
      await this.waitFor(ready, { label: `${url} to draw` });
      await sleep(settle);
      const issues = [];
      for (const event of events) {
        if (event.method === "Runtime.exceptionThrown") issues.push(`exception ${event.params.exceptionDetails.text} ${event.params.exceptionDetails.exception?.description?.slice(0, 160) ?? ""}`);
        if (event.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(event.params.type)) issues.push(`console.${event.params.type} ${event.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 160)}`);
        if (event.method === "Log.entryAdded" && ["error", "warning"].includes(event.params.entry.level)) issues.push(`log.${event.params.entry.level} ${event.params.entry.text.slice(0, 120)} ${event.params.entry.url ?? ""}`);
        if (event.method === "Network.responseReceived" && event.params.response.status >= 400) issues.push(`HTTP ${event.params.response.status} ${event.params.response.url}`);
        if (event.method === "Network.loadingFailed" && !event.params.canceled) issues.push(`request failed ${event.params.errorText}`);
      }
      return { issues, loads: events.filter((event) => event.method === "Page.frameNavigated" && !event.params.frame.parentId).length };
    },
    /* Answer requests whose URL matches with a 503, for the first `times` of them (Infinity: all). */
    async failRequests(pattern, times, onHit = () => {}) {
      let hits = 0;
      handler = async (event) => {
        if (event.method === "Page.frameNavigated" && !event.params.frame.parentId) return;
        if (event.method !== "Fetch.requestPaused") return;
        hits += 1;
        onHit(hits);
        if (hits <= times) await send("Fetch.fulfillRequest", { requestId: event.params.requestId, responseCode: 503, responseHeaders: [{ name: "Content-Type", value: "text/plain" }], body: Buffer.from("Service Unavailable").toString("base64") });
        else await send("Fetch.continueRequest", { requestId: event.params.requestId });
      };
      await send("Fetch.enable", { patterns: [{ urlPattern: pattern }] });
      return { hits: () => hits };
    },
    async stopFailing() {
      handler = null;
      await send("Fetch.disable");
    },
    navigations: () => events.filter((event) => event.method === "Page.frameNavigated" && !event.params.frame.parentId).length,
  };
}
