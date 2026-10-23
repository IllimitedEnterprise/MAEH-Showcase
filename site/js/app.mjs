/* The page: loads the data once, draws the view for the current hash, and handles the few
 * interactions (theme, ranges, legend, chart/table switch, file views, the two verifiers). */

import { DataError, createData, dayFile, loadCore, loadDay, verifyChain, verifyDayFiles } from "./lib/data.mjs";
import { NAV, parseRoute, section } from "./lib/router.mjs";
import { announce, copyText, mount, on } from "./lib/dom.mjs";
import { applyTheme, currentTheme, storedTheme, toggleTheme } from "./lib/theme.mjs";
import { html } from "./lib/html.mjs";
import { longDate, mediumDate } from "./lib/fmt.mjs";
import { SITE_NAME } from "./lib/site.mjs";
import { dayEntry } from "./lib/model.mjs";
import { errorState } from "./ui.mjs";
import { chainResultHtml } from "./views/integrity.mjs";
import { viewFor } from "./views/index.mjs";

const state = { range: "all", isolated: null };
let ctx = null;
let current = null;
let token = 0;

const $ = (selector) => document.querySelector(selector);

function setNav(route) {
  const active = section(route);
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function syncThemeButton() {
  const button = $('[data-action="toggle-theme"]');
  if (!button) return;
  const next = currentTheme() === "dark" ? "light" : "dark";
  button.setAttribute("aria-label", `Switch to the ${next} theme`);
  button.setAttribute("title", `Switch to the ${next} theme`);
}

function fillFooter() {
  const meta = $("#footer-meta");
  if (!meta || !ctx) return;
  const tip = ctx.core.index.tip;
  const build = ctx.build;
  mount(meta, html`<span>${tip ? `Latest freeze #${tip.seq}, ${mediumDate(tip.date)}` : "Nothing frozen yet"}</span>${build ? html`<span>Build <code>${build.build}</code></span>` : ""}`);
}

const sameSpot = (a, b) => Boolean(a) && a.name === b.name && (a.name === "stars" || a.name === "calendar" || (a.name === "day" && a.date === b.date) || a.name === "season");

async function navigate({ first = false, keepScroll = false } = {}) {
  const route = parseRoute(window.location.hash);
  const mine = ++token;
  const view = viewFor(ctx.core, route);
  const target = $("#view");
  setNav(route);
  target.classList.add("is-loading");
  $("#main").setAttribute("aria-busy", "true");
  const previous = current;
  try {
    const model = await view.load(ctx, route);
    if (mine !== token) return;
    const out = view.render(model, ctx);
    const scrollY = window.scrollY;
    mount(target, out.markup);
    document.title = `${out.title} · ${SITE_NAME}`;
    out.after?.(target, ctx);
    current = route;
    if (keepScroll || sameSpot(previous, route)) {
      window.scrollTo({ top: scrollY, behavior: "instant" });
      if (route.name === "day" && previous?.file !== route.file) target.querySelector(".viewer")?.scrollIntoView({ block: "nearest" });
      if (route.name === "stars" && previous?.tab !== route.tab && !keepScroll) target.querySelector(".tabs")?.scrollIntoView({ block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
      if (!first) target.querySelector("h1")?.focus({ preventScroll: true });
    }
    if (!first) announce(out.title);
  } catch (error) {
    if (mine !== token) return;
    console.error(error);
    mount(target, errorState(error));
    document.title = `Problem · ${SITE_NAME}`;
  } finally {
    if (mine === token) {
      target.classList.remove("is-loading");
      $("#main").removeAttribute("aria-busy");
    }
  }
}

const rerender = () => navigate({ keepScroll: true });

function setPressed(group, value) {
  for (const button of group.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.value === value));
}

function bindActions() {
  const root = document;
  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const value = button.dataset.value;
    if (action === "toggle-theme") { toggleTheme(); syncThemeButton(); return; }
    if (action === "reload") { window.location.reload(); return; }
    if (action === "range") { state.range = value; rerender(); return; }
    if (action === "isolate") { state.isolated = state.isolated === value ? null : value; rerender(); return; }

    if (action === "chart-view") {
      const cardElement = button.closest(".chart-card");
      cardElement.querySelector(".chart-box").hidden = value === "table";
      cardElement.querySelector(".chart-table").hidden = value !== "table";
      setPressed(button.parentElement, value);
      return;
    }
    if (action === "file-view") {
      const viewer = button.closest(".viewer");
      for (const panel of viewer.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== value;
      setPressed(button.parentElement, value);
      return;
    }
    if (action === "copy-file") {
      const text = button.closest(".viewer").querySelector(".code")?.textContent ?? "";
      announce((await copyText(text)) ? "Copied to the clipboard" : "Could not copy");
      return;
    }
    if (action === "verify-day") {
      const date = button.dataset.date;
      const result = $("#verify-result");
      const entry = dayEntry(ctx.core, date);
      button.disabled = true;
      result.textContent = "Checking…";
      try {
        const manifest = await loadDay(ctx.data, date);
        const outcome = await verifyDayFiles(ctx.data, date, manifest, entry, (done, total) => { result.textContent = `Checked ${done} of ${total}…`; });
        result.textContent = outcome.failed.length === 0
          ? `All ${outcome.total} files match their recorded SHA-256 for ${longDate(date)}.`
          : `${outcome.failed.length} of ${outcome.total} files do not match: ${outcome.failed.join(", ")}.`;
        result.classList.toggle("is-bad", outcome.failed.length > 0);
        result.classList.toggle("is-ok", outcome.failed.length === 0);
      } catch (error) {
        result.textContent = error instanceof DataError ? `Could not read ${error.path}.` : "The check could not finish.";
        result.classList.add("is-bad");
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (action === "verify-chain") {
      const progress = $("#chain-progress");
      const fill = $("#chain-progress-fill");
      const result = $("#chain-result");
      button.disabled = true;
      progress.hidden = false;
      fill.style.setProperty("--w", "0%");
      try {
        const outcome = await verifyChain(ctx.data, ctx.core, (done, total) => fill.style.setProperty("--w", `${Math.round((done / total) * 100)}%`));
        mount(result, chainResultHtml(outcome));
        announce(outcome.ok ? "The chain checks out" : "A problem was found in the chain");
      } catch (error) {
        mount(result, html`<p class="verify-bad" role="alert">The check could not finish: ${error.message}</p>`);
      } finally {
        button.disabled = false;
        progress.hidden = true;
      }
    }
  });
}

async function boot() {
  const target = $("#view");
  applyTheme(storedTheme() ?? "dark");
  syncThemeButton();
  bindActions();
  window.addEventListener("hashchange", () => navigate());
  try {
    let build = null;
    try {
      build = await createData().fresh("build.json");
    } catch {
      build = null;
    }
    const data = createData({ build: build?.build ?? "" });
    const core = await loadCore(data);
    ctx = { data, core, state, build };
    fillFooter();
  } catch (error) {
    console.error(error);
    mount(target, errorState(error));
    return;
  }
  await navigate({ first: true });
}

boot();
