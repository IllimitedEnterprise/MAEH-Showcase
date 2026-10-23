/* One frozen day: the desk result, the Star, every account, the hours, and the day's files. */

import { html } from "../lib/html.mjs";
import { DASH, int, longDate, pct, plural, profitFactor, shortDate, two, weekday } from "../lib/fmt.mjs";
import { dayFile, loadDay, loadFile } from "../lib/data.mjs";
import { href } from "../lib/router.mjs";
import { crownNote, dayEntry, neighbours } from "../lib/model.mjs";
import { accountChip, badge, card, crownMark, emptyState, icon, kindBadge, moneyHtml, notice, pageHead, standingsTable, statGrid, statTile, statusBadge, toneClass } from "../ui.mjs";
import { hoursChart } from "../charts/draw.mjs";
import { mountChart } from "../charts/interact.mjs";
import { describeFile, treeHtml, treeModel, viewerHtml, visualFor } from "./files.mjs";

export async function load(ctx, route) {
  const { core, data } = ctx;
  const date = route.date;
  const entry = dayEntry(core, date);
  if (!entry) return { core, date, missing: true };

  const [manifest, desk, stars] = await Promise.all([
    loadDay(data, date),
    data.json(dayFile(date, "desk.json")),
    data.json(dayFile(date, "stars.json")),
  ]);
  const rel = route.file ?? "README.md";
  const known = rel === "day.json" || Object.hasOwn(manifest.files, rel);
  let file = null;
  let visual = null;
  if (known) {
    file = await loadFile(data, date, rel, rel === "day.json" ? { sha256: entry.sha256 } : manifest.files[rel]);
    visual = visualFor({ core, date, rel, text: file.text, manifest, entry });
  }
  return { core, date, entry, manifest, desk, stars, rel, known, file, visual, tree: treeModel(core, manifest) };
}

function starCard(core, stars, date) {
  if (stars.crown) {
    const row = stars.rows.find((r) => r.key === stars.crown.key);
    return html`<aside class="star-card" aria-labelledby="star-h">
<p class="eyebrow" id="star-h">${crownMark()} Star of the day</p>
<p class="star-name">${accountChip(core, stars.crown.key, { label: stars.crown.label })}</p>
<dl class="star-facts"><div><dt>Score</dt><dd class="figure">${two(stars.crown.score)}</dd></div><div><dt>Net</dt><dd>${moneyHtml(stars.crown.net)}</dd></div><div><dt>Closes</dt><dd class="figure">${int(row?.n)}</dd></div></dl>
</aside>`;
  }
  return html`<aside class="star-card is-empty" aria-labelledby="star-h"><p class="eyebrow" id="star-h">Star of the day</p><p class="star-name">No Star</p><p class="muted">${crownNote(stars.rows)}</p></aside>`;
}

/* Under the entry-hours chart: how many of the day's closes were not opened on the day itself. */
function openedNote(hours) {
  const parts = [];
  if (hours.earlier > 0) parts.push(`${int(hours.earlier)} had been opened before this day`);
  if (hours.unknown > 0) parts.push(`${int(hours.unknown)} ${hours.unknown === 1 ? "has" : "have"} no recorded entry`);
  if (parts.length) return `${parts.join("; ")}.`;
  return hours.total === 0 ? "" : "Every one of them was opened on this day.";
}

/* The day the clocks change has 23 or 25 hours; the chart says why it has that many columns. */
const clockNote = (hours) => (hours === 24 ? "" : html`<p class="muted small">${hours === 25
  ? "The clocks went back on this day, so it lasted 25 hours and one clock hour happens twice. Trades opened in either of them are counted together in that hour's column."
  : "The clocks went forward on this day, so it lasted 23 hours and one clock hour does not exist. The chart has no column for it."}</p>`);

const CAUTION = {
  partial: "Part of what this account closed could not be read completely, so its numbers may be missing trades.",
  unverified: "The closes that were read do not add up to the account's balance, so its numbers cannot be proven complete.",
};

/* A day that was frozen partial, or holds an account that could not be proven complete, says so and why. */
function caution(core, date, manifest) {
  const flagged = Object.entries(manifest.accounts).filter(([, status]) => Object.hasOwn(CAUTION, status));
  if (manifest.status === "complete" && flagged.length === 0) return "";
  const summary = (key) => `accounts/${key}/summary.md`;
  return notice({
    id: "caution-h",
    title: "Read these numbers with care",
    body: html`<p>${flagged.length ? "Not every account could be proven complete when this day was frozen. Their numbers are published as they were found, and an account in this state is left out of the ranking for the day and for any week or month that includes it." : "This day was frozen as partial: some of its data could not be read completely."}</p>${flagged.length ? html`<ul class="notice-list" role="list">${flagged.map(([key, status]) => html`<li>${accountChip(core, key)} ${statusBadge(status)} <span>${CAUTION[status]}</span>${Object.hasOwn(manifest.files, summary(key)) ? html` <a href="${href({ name: "day", date, file: summary(key) })}">Its summary</a>` : ""}</li>`)}</ul>` : ""}`,
  });
}

function netByAccount(core, desk) {
  const rows = [...desk.perAccount].filter((row) => row.n > 0).sort((a, b) => b.net - a.net);
  const top = Math.max(1, ...rows.map((row) => Math.abs(row.net)));
  if (rows.length === 0) return html`<p class="muted">No account closed a trade on this day.</p>`;
  return html`<ul class="bars-list" role="list">${rows.map((row) => html`<li><span class="bl-name">${accountChip(core, row.key, { label: row.label })}</span><span class="bl-n">${int(row.n)}×</span><span class="bl-bar"><span class="bl-fill ${row.net >= 0 ? "gain" : "loss"}" data-style="--w:${Math.max(2, Math.round((Math.abs(row.net) / top) * 100))}%"></span></span><span class="bl-val">${moneyHtml(row.net, { arrow: false })}</span></li>`)}</ul>`;
}

export function render(model, ctx) {
  const { core } = model;
  if (model.missing) {
    return {
      title: model.date,
      markup: html`<div class="page">${pageHead({ eyebrow: "Day", title: model.date })}${emptyState("Nothing is frozen for this day", "Either it has not happened yet, or it is not part of the season. The calendar shows every day that is.", html`<p><a class="btn" href="${href({ name: "calendar", month: model.date.slice(0, 7) })}">Open the calendar</a></p>`)}</div>`,
      after() {},
    };
  }
  const { date, entry, manifest, desk, stars, rel, known, file, visual, tree } = model;
  const { prev, next } = neighbours(core, date);
  const hours = manifest.window.hours;
  const opened = openedNote(desk.hours);

  const nav = html`<nav class="day-nav" aria-label="Move between days">
${prev ? html`<a class="btn btn-ghost" href="${href({ name: "day", date: prev, file: null })}">${icon("chevron-left")} ${shortDate(prev)}</a>` : html`<span class="btn btn-ghost is-disabled" aria-disabled="true">${icon("chevron-left")} Earlier</span>`}
<a class="btn btn-ghost" href="${href({ name: "calendar", month: date.slice(0, 7) })}">${icon("calendar")} Calendar</a>
${next ? html`<a class="btn btn-ghost" href="${href({ name: "day", date: next, file: null })}">${shortDate(next)} ${icon("chevron-right")}</a>` : html`<span class="btn btn-ghost is-disabled" aria-disabled="true">Later ${icon("chevron-right")}</span>`}
</nav>`;

  const markup = html`<div class="page day">
${pageHead({
    eyebrow: `${weekday(date)} · freeze #${entry.seq}`,
    title: longDate(date),
    badges: html`${statusBadge(manifest.status)}${kindBadge(manifest.kind)}${hours !== 24 ? badge(`${hours}-hour day`, "info", { icon: "info", title: "Daylight saving time changed the length of this day." }) : ""}${badge(`Rules ${manifest.rules}`, "neutral")}`,
    actions: nav,
  })}
${caution(core, date, manifest)}
<div class="hero card glass-strong">
<div class="hero-main">
<p class="eyebrow">Desk net for the day</p>
<p class="hero-figure ${toneClass(desk.net)}"><span class="sr-only">Desk net: </span>${moneyHtml(desk.net)}<span class="unit">EUR</span></p>
<p class="hero-caption">${desk.n === 0 ? "No trade closed on this day." : html`${plural(desk.n, "close")} · ${pct(desk.winRatePct)} won · profit factor ${profitFactor(desk.profitFactor, desk.grossWin)}${desk.best ? html` · best <a href="${href({ name: "account", key: desk.best.key })}">${core.index.accounts.find((a) => a.key === desk.best.key)?.label ?? desk.best.key}</a>` : ""}`}</p>
</div>
${starCard(core, stars, date)}
</div>

<div class="grid-2">
${card({ id: "by-account", title: "Net by account", subtitle: "Only accounts that closed a trade are drawn.", body: netByAccount(core, desk) })}
${card({ id: "day-hours", title: "When the trades were opened", subtitle: "Trades that closed on this day, by the hour they were opened.", body: html`<div class="chart-box" id="day-hours-box" tabindex="0" role="group" aria-label="Entry hours of the day's trades. Use the arrow keys to step through the hours."></div>${opened ? html`<p class="muted small">${opened}</p>` : ""}${clockNote(hours)}` })}
</div>

${card({ id: "standings", title: "Star standings", subtitle: "Ranked by score. The score blends return, profit factor, drawdown and win rate, then leans toward 50 when an account made few closes.", body: standingsTable(core, stars.rows, { crownKey: stars.crown?.key ?? null, caption: `Star standings for ${longDate(date)}` }), actions: html`<a class="btn btn-ghost" href="${href({ name: "stars", tab: "day" })}">How it works ${icon("arrow-right")}</a>` })}

<section class="files" aria-labelledby="files-h">
<div class="section-head"><h2 class="section-title" id="files-h">The day's files</h2>
<p class="section-sub">${Object.keys(manifest.files).length + 1} files, frozen together. Each one is checked against its recorded SHA-256 in your browser as it opens.</p>
<div class="verify-box"><button type="button" class="btn" data-action="verify-day" data-date="${date}">${icon("shield")} Check every file</button><span class="verify-result" id="verify-result" role="status" aria-live="polite"></span></div></div>
<div class="files-layout">
<aside class="files-side card" aria-label="File list">${treeHtml(core, date, manifest, tree, known ? rel : null)}</aside>
<div class="files-main">${viewerHtml({ core, date, rel, file, visual, missing: !known })}</div>
</div>
</section>
</div>`;

  return {
    title: longDate(date),
    markup,
    after(root) {
      mountChart(root.querySelector("#day-hours-box"), (width) => hoursChart({ uid: "dayhours", width, title: "Entry hours", description: `${plural(desk.n, "trade")} closed on ${longDate(date)}, by the hour they were opened.`, buckets: desk.hours.buckets, slot: 0 }));
      visual?.mount?.(root);
    },
  };
}
