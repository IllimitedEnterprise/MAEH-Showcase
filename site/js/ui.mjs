/* The pieces every page is made of. Each returns trusted markup built by the html helper, so a
 * label or a number from a data file can never become markup. */

import { html, join, raw } from "./lib/html.mjs";
import { styleData } from "./lib/dom.mjs";
import { DASH, KIND_LABEL, STATUS_LABEL, int, money, one, pct, profitFactor, tidyCounts, tone, two } from "./lib/fmt.mjs";
import { href } from "./lib/router.mjs";
import { entityClass, labelOf } from "./lib/model.mjs";
import { clamp } from "./lib/scale.mjs";

export const icon = (name, className = "") => html`<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

/* A signed amount with its marker. Sign and arrow carry the meaning; colour only repeats it. */
export function moneyHtml(value, { arrow = true } = {}) {
  const t = tone(value);
  const mark = arrow && (t === "gain" || t === "loss") ? icon(t === "gain" ? "up" : "down", "money-arrow") : "";
  const none = t === "none" ? html`<span class="sr-only"> no data</span>` : "";
  return html`<span class="money ${t}">${mark}<span class="money-figure">${money(value)}</span>${none}</span>`;
}

export const toneClass = (value) => tone(value);

export function badge(text, kind = "neutral", { icon: name = null, title = null } = {}) {
  return html`<span class="badge badge-${kind}"${title ? html` title="${title}"` : ""}>${name ? icon(name) : ""}<span>${text}</span></span>`;
}

const STATUS_KIND = { complete: "ok", ok: "ok", partial: "warn", unverified: "warn", quiet: "neutral", prefunding: "neutral" };
const STATUS_ICON = { complete: "check", ok: "check", partial: "warn", unverified: "warn" };
export const statusBadge = (status) => badge(STATUS_LABEL[status] ?? status, STATUS_KIND[status] ?? "neutral", { icon: STATUS_ICON[status] ?? null });

const KIND_ICON = { nightly: "moon", catchup: "history", backfilled: "history" };
export const kindBadge = (kind) => badge(KIND_LABEL[kind] ?? kind, "info", { icon: KIND_ICON[kind] ?? null });

export function accountChip(core, key, { link = true, label = null } = {}) {
  const inner = html`<span class="swatch" aria-hidden="true"></span><span class="chip-label">${label ?? labelOf(core, key)}</span>`;
  return link
    ? html`<a class="chip-account ${entityClass(core, key)}" href="${href({ name: "account", key })}">${inner}</a>`
    : html`<span class="chip-account ${entityClass(core, key)}">${inner}</span>`;
}

export function crownMark(label = "Star") {
  return html`<span class="crown-mark" title="${label}">${icon("crown")}<span class="sr-only">${label}</span></span>`;
}

export function statTile({ label, value, hint = null, tone: toneName = null }) {
  return html`<div class="stat"><dt class="stat-label">${label}</dt><dd class="stat-value ${toneName ?? ""}">${value}</dd>${hint ? html`<dd class="stat-hint">${hint}</dd>` : ""}</div>`;
}

export const statGrid = (tiles, className = "") => html`<dl class="stats ${className}">${tiles}</dl>`;

export function card({ id, title, subtitle = null, actions = null, body, className = "", level = 2 }) {
  return html`<section class="card ${className}" aria-labelledby="${id}-h">
<header class="card-head"><div class="card-titles">${raw(`<h${level} id="${id}-h" class="card-title">`)}${title}${raw(`</h${level}>`)}${subtitle ? html`<p class="card-sub">${subtitle}</p>` : ""}</div>${actions ? html`<div class="card-actions">${actions}</div>` : ""}</header>
<div class="card-body">${body}</div>
</section>`;
}

export function pageHead({ eyebrow = null, title, lede = null, badges = null, actions = null }) {
  return html`<header class="page-head">
${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ""}
<h1 class="page-title" tabindex="-1">${title}</h1>
${badges ? html`<div class="badges">${badges}</div>` : ""}
${lede ? html`<p class="lede">${lede}</p>` : ""}
${actions ? html`<div class="page-actions">${actions}</div>` : ""}
</header>`;
}

export function tabs({ label, items }) {
  return html`<nav class="tabs" aria-label="${label}">${items.map((item) => html`<a class="tab" href="${item.href}"${item.current ? raw(' aria-current="page"') : ""}>${item.label}</a>`)}</nav>`;
}

/* A row of buttons where one is pressed: ranges, view modes, filters. */
export function segmented({ label, action, options, current }) {
  return html`<div class="seg" role="group" aria-label="${label}">${options.map((option) => html`<button type="button" class="seg-btn" data-action="${action}" data-value="${option.value}" aria-pressed="${option.value === current ? "true" : "false"}">${option.label}</button>`)}</div>`;
}

/* A chart with its table twin, behind a Chart/Table switch. */
export function chartCard({ id, title, subtitle = null, legend = null, table, label, filters = null, className = "" }) {
  const switcher = segmented({ label: `${title} view`, action: "chart-view", current: "chart", options: [{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }] });
  return card({
    id, title, subtitle, className: `chart-card ${className}`,
    actions: html`${filters ?? ""}<div data-view-of="${id}">${switcher}</div>`,
    body: html`${legend ?? ""}<div class="chart-box" id="${id}-box" tabindex="0" role="group" aria-label="${label}"></div><div class="chart-table" id="${id}-table" hidden>${table}</div>`,
  });
}

export function table({ caption, columns, rows, className = "", rowClass = null }) {
  return html`<div class="table-wrap"><table class="table ${className}">
<caption class="sr-only">${caption}</caption>
<thead><tr>${columns.map((column) => html`<th scope="col" class="${column.align ?? "left"} ${column.className ?? ""}">${column.label}</th>`)}</tr></thead>
<tbody>${rows.map((row) => html`<tr class="${rowClass ? rowClass(row) : ""}">${columns.map((column) => html`<td class="${column.align ?? "left"} ${column.className ?? ""}" data-label="${column.label}">${column.cell(row)}</td>`)}</tr>`)}</tbody>
</table></div>`;
}

export const scoreMeter = (score) => html`<span class="meter" aria-hidden="true"><span class="meter-fill" ${styleData({ "--w": `${clamp(score ?? 0, 0, 100)}%` })}></span></span>`;

const MARKS = [["ret", "Return"], ["pf", "Profit factor"], ["dd", "Drawdown"], ["win", "Win rate"]];
/* The four marks behind a score, as four little columns. */
export function compMarks(comp) {
  if (!comp) return html`<span class="muted" aria-label="not scored">${DASH}</span>`;
  const text = `${MARKS.map(([key, name]) => `${name} ${Math.round(comp[key] * 100)}`).join(", ")}, credibility ${Math.round(comp.cred * 100)} percent`;
  return html`<span class="marks" role="img" aria-label="${text}" title="${text}">${MARKS.map(([key]) => html`<span class="mark"><span class="mark-fill" ${styleData({ "--h": `${Math.round(comp[key] * 100)}%` })}></span></span>`)}</span>`;
}

export function emptyState(title, body, action = null) {
  return html`<div class="empty"><h2 class="empty-title">${title}</h2><p>${body}</p>${action ?? ""}</div>`;
}

/* A note that sits above the content it qualifies: not an error, but something to read first. */
export function notice({ title, body, id }) {
  return html`<aside class="notice" role="note" aria-labelledby="${id}">${icon("warn")}<div><p class="notice-title" id="${id}">${title}</p>${body}</div></aside>`;
}

export function errorState(error) {
  const detail = error?.path ? `The file ${error.path} could not be read.` : "Something went wrong while drawing this page.";
  return html`<div class="empty empty-error" role="alert"><h2 class="empty-title">This page could not load</h2><p>${detail}</p><p class="muted">The data is plain files in the repository; if the site was just updated, reloading in a minute usually fixes it.</p><p><button type="button" class="btn" data-action="reload">Reload</button> <a class="btn btn-ghost" href="#/">Back to the season</a></p></div>`;
}

export const dash = DASH;
export { int, one, pct, profitFactor, two, join };

/* Standings, used by the day, week, month and all-time views. */
export function standingsTable(core, rows, { crownKey = null, caption }) {
  return table({
    caption,
    className: "standings",
    rowClass: (row) => (row.qualified ? (row.key === crownKey ? "is-crown" : "") : "is-unranked"),
    columns: [
      { label: "Rank", align: "right", className: "col-rank", cell: (row) => (row.rank === null ? DASH : row.key === crownKey ? html`${crownMark()}<span class="rank-n">${row.rank}</span>` : html`<span class="rank-n">${row.rank}</span>`) },
      { label: "Account", cell: (row) => accountChip(core, row.key, { label: row.label }) },
      { label: "Score", align: "right", className: "col-score", cell: (row) => html`<span class="score-figure">${two(row.score)}</span>${scoreMeter(row.score)}` },
      { label: "Net", align: "right", cell: (row) => moneyHtml(row.net, { arrow: false }) },
      { label: "Return", align: "right", className: "col-optional", cell: (row) => pct(row.retPct, { signed: true, digits: 2 }) },
      { label: "Closes", align: "right", className: "col-optional", cell: (row) => int(row.n) },
      { label: "Marks", className: "col-marks", cell: (row) => compMarks(row.comp) },
      { label: "Note", className: "col-note", cell: (row) => (row.qualified ? "" : html`<span class="why">${row.why.map(tidyCounts).join("; ")}</span>`) },
    ],
    rows,
  });
}
