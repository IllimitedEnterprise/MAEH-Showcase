/* The file browser of a day: a tree of the day's files, and a viewer that shows each one in the
 * form a person can read (a table, a chart, a report) next to the exact bytes that were frozen.
 * Every file is hashed in the viewer's own browser and compared with the manifest. */

import { html, raw } from "../lib/html.mjs";
import { renderMarkdown } from "../lib/markdown.mjs";
import { highlight } from "../lib/highlight.mjs";
import { parseCsv } from "../lib/csv.mjs";
import { DASH, bytes, int, longDate, one, pct, profitFactor, rMultiple, shortDate, two } from "../lib/fmt.mjs";
import { KIND_OF_PATH, dayFile } from "../lib/data.mjs";
import { href } from "../lib/router.mjs";
import { accountKeys, entitySlot, labelOf } from "../lib/model.mjs";
import { accountChip, badge, crownMark, icon, moneyHtml, segmented, standingsTable, statGrid, statTile, statusBadge, table } from "../ui.mjs";
import { chartTable, hoursChart } from "../charts/draw.mjs";
import { mountChart } from "../charts/interact.mjs";

const ROOT_ORDER = ["README.md", "day.json", "desk.json", "stars.json"];
const ACCOUNT_ORDER = ["summary.md", "summary.json", "trades.json", "trades.csv", "hours.json"];

const DESCRIPTION = {
  "README.md": "The day in words: status, desk result, the Star and a results table.",
  "day.json": "The manifest: the day's window, status, every file's SHA-256, and the link to the day before.",
  "desk.json": "The whole desk: totals, each account's result and when the day's trades were opened.",
  "stars.json": "The Star standings for this day: scores, ranks and the crown.",
  "summary.md": "One account's day, as a short report.",
  "summary.json": "One account's day, as figures: results, risk, symbols and the balance check.",
  "trades.json": "Every close of the day: symbol, side, net result and R. No times are published.",
  "trades.csv": "The same closes as a spreadsheet file.",
  "hours.json": "How many of the day's closed trades were opened in each hour of the day.",
};
export const describeFile = (rel) => DESCRIPTION[rel.split("/").at(-1)] ?? "";

const byOrder = (order) => (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b);

export function treeModel(core, manifest) {
  const files = Object.keys(manifest.files);
  const root = ["day.json", ...files.filter((rel) => !rel.includes("/"))];
  root.sort(byOrder(ROOT_ORDER));
  const accounts = [];
  for (const key of accountKeys(core)) {
    const prefix = `accounts/${key}/`;
    const own = files.filter((rel) => rel.startsWith(prefix)).map((rel) => rel.slice(prefix.length)).sort(byOrder(ACCOUNT_ORDER));
    if (own.length > 0) accounts.push({ key, files: own.map((name) => `${prefix}${name}`) });
  }
  return { root, accounts };
}

export function treeHtml(core, date, manifest, tree, current) {
  const item = (rel) => html`<li><a class="tree-file kind-${KIND_OF_PATH(rel)}" href="${href({ name: "day", date, file: rel })}"${rel === current ? raw(' aria-current="page"') : ""} title="${describeFile(rel)}"><span class="tree-name">${rel.split("/").at(-1)}</span><span class="tree-size">${manifest.files[rel] ? bytes(manifest.files[rel].bytes) : ""}</span></a></li>`;
  return html`<nav class="tree" aria-label="Files of ${longDate(date)}"><ul class="tree-root">${tree.root.map(item)}</ul>
<p class="tree-heading">Accounts</p>
<ul class="tree-root">${tree.accounts.map((account) => html`<li><details class="tree-dir"${current?.startsWith(`accounts/${account.key}/`) ? raw(" open") : ""}><summary>${accountChip(core, account.key, { link: false })}</summary><ul>${account.files.map(item)}</ul></details></li>`)}</ul></nav>`;
}

const safeJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

function hoursBlock(uid, hours, slot, noun = "trades") {
  return {
    markup: html`<div class="chart-box chart-inline" id="${uid}-box" tabindex="0" role="group" aria-label="Entry hours. Use the arrow keys to step through the hours."></div>
<p class="muted small">${int(hours.total - hours.earlier - hours.unknown)} of ${int(hours.total)} trades were opened on this day${hours.earlier > 0 ? `; ${int(hours.earlier)} had been opened earlier` : ""}${hours.unknown > 0 ? `; ${int(hours.unknown)} have no recorded entry` : ""}.</p>`,
    mount: (root) => mountChart(root.querySelector(`#${uid}-box`), (width) => hoursChart({ uid, width, title: "Entry hours", description: `${int(hours.total)} trades closed this day, by the hour they were opened.`, buckets: hours.buckets, slot, noun })),
  };
}

function deskVisual(core, desk) {
  const hours = hoursBlock("fv-desk-hours", desk.hours, 0);
  return {
    markup: html`${statGrid(html`
${statTile({ label: "Desk net", value: moneyHtml(desk.net) })}
${statTile({ label: "Closes", value: int(desk.n), hint: `${int(desk.wins)} won · ${int(desk.losses)} lost` })}
${statTile({ label: "Win rate", value: pct(desk.winRatePct) })}
${statTile({ label: "Profit factor", value: profitFactor(desk.profitFactor, desk.grossWin) })}`, "stats-4")}
<h3 class="viewer-sub">Accounts</h3>
${table({ caption: "Each account's result for the day", columns: [
    { label: "Account", cell: (row) => accountChip(core, row.key, { label: row.label }) },
    { label: "Status", cell: (row) => statusBadge(row.status) },
    { label: "Closes", align: "right", cell: (row) => int(row.n) },
    { label: "Net", align: "right", cell: (row) => moneyHtml(row.net, { arrow: false }) },
  ], rows: desk.perAccount })}
<h3 class="viewer-sub">When the trades were opened</h3>${hours.markup}`,
    mount: hours.mount,
  };
}

function starsVisual(core, stars) {
  return {
    markup: html`<p class="viewer-note">${stars.crown ? html`${crownMark()} Star of the day: ${accountChip(core, stars.crown.key, { label: stars.crown.label })} with a score of ${two(stars.crown.score)}.` : "No Star was awarded for this day."} Rules ${stars.rules}.</p>
${standingsTable(core, stars.rows, { crownKey: stars.crown?.key ?? null, caption: "Star standings for the day" })}
${stars.withheld?.length ? html`<p class="muted small">Withheld from ranking: ${stars.withheld.map((w) => `${w.label ?? w.key}`).join(", ")}.</p>` : ""}`,
    mount: null,
  };
}

function summaryVisual(core, summary) {
  const pairs = (summary.pairs ?? []).slice(0, 12);
  const top = Math.max(1, ...pairs.map((p) => Math.abs(p.net)));
  return {
    markup: html`<p class="viewer-note">${accountChip(core, summary.key, { label: summary.label })} ${statusBadge(summary.status)} <span class="muted">Read from the ${summary.source === "api" ? "harness API" : summary.source === "ledger" ? "close ledger" : summary.source === "both" ? "harness API and close ledger" : "harness"}.</span></p>
${summary.reasons?.length ? html`<p class="viewer-warn">${icon("warn")} ${summary.reasons.join(" ")}</p>` : ""}
${statGrid(html`
${statTile({ label: "Net", value: moneyHtml(summary.net), hint: summary.funding ? `${pct(summary.retPct, { signed: true, digits: 2 })} on ${int(summary.funding)} EUR` : null })}
${statTile({ label: "Closes", value: int(summary.n), hint: `${int(summary.wins)} won · ${int(summary.losses)} lost · ${int(summary.breakevens)} even` })}
${statTile({ label: "Win rate", value: pct(summary.winRatePct), hint: summary.streaks ? `Runs: ${summary.streaks.maxWins} wins, ${summary.streaks.maxLosses} losses` : null })}
${statTile({ label: "Profit factor", value: profitFactor(summary.profitFactor, summary.grossWin), hint: `${two(summary.grossWin)} won vs ${two(summary.grossLoss)} lost` })}
${statTile({ label: "Deepest fall", value: two(summary.maxDrawdown), hint: `${pct(summary.ddPct, { digits: 2 })} of funding` })}
${statTile({ label: "R", value: summary.r ? rMultiple(summary.r.sum) : DASH, hint: summary.r ? `over ${int(summary.r.count)} closes` : "not linked for this day" })}`)}
${pairs.length ? html`<h3 class="viewer-sub">Symbols</h3><ul class="bars-list" role="list">${pairs.map((pair) => html`<li><span class="bl-name">${pair.symbol}</span><span class="bl-n">${int(pair.n)}×</span><span class="bl-bar"><span class="bl-fill ${pair.net >= 0 ? "gain" : "loss"}" data-style="--w:${Math.max(2, Math.round((Math.abs(pair.net) / top) * 100))}%"></span></span><span class="bl-val">${moneyHtml(pair.net, { arrow: false })}</span></li>`)}</ul>` : ""}
<p class="muted small">Balance check: ${summary.chain?.ok ? "the day's result reconciles with the account's balance." : summary.chain?.gap === null || summary.chain?.gap === undefined ? "not available for this day." : `a gap of ${two(summary.chain.gap)} EUR remains, so this day is not counted for Stars.`}</p>`,
    mount: null,
  };
}

function tradesTable(rows) {
  const shown = rows.slice(0, 400);
  return html`${table({
    caption: "Closed trades",
    className: "table-compact",
    columns: [
      { label: "#", align: "right", cell: (row) => row.i },
      { label: "Symbol", cell: (row) => row.symbol },
      { label: "Side", cell: (row) => html`<span class="side side-${row.side}">${row.side === "long" ? "Long" : row.side === "short" ? "Short" : row.side}</span>` },
      { label: "Net", align: "right", cell: (row) => moneyHtml(row.net, { arrow: false }) },
      { label: "R", align: "right", cell: (row) => rMultiple(row.r) },
    ],
    rows: shown,
  })}${rows.length > shown.length ? html`<p class="muted small">Showing the first ${shown.length} of ${rows.length}; the raw file has them all.</p>` : ""}`;
}

function tradesVisual(core, trades, key) {
  const wins = trades.filter((t) => t.net > 0).length;
  const losses = trades.filter((t) => t.net < 0).length;
  const net = Math.round(trades.reduce((sum, t) => sum + t.net, 0) * 100) / 100;
  return {
    markup: html`<p class="viewer-note">${key ? accountChip(core, key, { label: labelOf(core, key) }) : ""} <span class="muted">${int(trades.length)} closes, in the order they closed. Times are not published.</span></p>
${statGrid(html`${statTile({ label: "Net", value: moneyHtml(net) })}${statTile({ label: "Won", value: int(wins) })}${statTile({ label: "Lost", value: int(losses) })}${statTile({ label: "Even", value: int(trades.length - wins - losses) })}`, "stats-4")}
${trades.length ? tradesTable(trades) : html`<p class="muted">No trades closed in this account on this day.</p>`}`,
    mount: null,
  };
}

function hoursVisual(core, hours) {
  const block = hoursBlock("fv-hours", hours, entitySlot(core, hours.key), "trades");
  const rows = hours.buckets.filter((b) => b.n > 0);
  return {
    markup: html`<p class="viewer-note">${hours.key ? accountChip(core, hours.key, { label: labelOf(core, hours.key) }) : ""} <span class="muted">Hours are in ${hours.zone} time and name the hour a trade was opened, for trades that closed on this day.</span></p>
${block.markup}
<details class="data-details"><summary>Table</summary>${chartTable({ caption: "Trades opened per hour", columns: [{ label: "Hour", cell: (b) => `${b.h}${DASH}${String((Number(b.h.slice(0, 2)) + 1) % 24).padStart(2, "0")}:00` }, { label: "Trades", align: "right", cell: (b) => int(b.n) }], rows })}</details>`,
    mount: block.mount,
  };
}

function manifestVisual(core, date, manifest, entry) {
  const files = Object.entries(manifest.files).map(([rel, info]) => ({ rel, ...info }));
  return {
    markup: html`${statGrid(html`
${statTile({ label: "Sequence", value: `#${manifest.seq}`, hint: manifest.prev ? `after #${manifest.prev.seq}, ${shortDate(manifest.prev.date)}` : "the first day" })}
${statTile({ label: "Status", value: statusBadge(manifest.status), hint: `${manifest.kind}` })}
${statTile({ label: "Window", value: `${manifest.window.hours} h`, hint: `${manifest.zone}, UTC${manifest.window.startOff}` })}
${statTile({ label: "Rules", value: manifest.rules, hint: `frozen ${manifest.capturedAt.slice(0, 10)}` })}`)}
<h3 class="viewer-sub">Accounts</h3>
<ul class="chip-list">${Object.entries(manifest.accounts).map(([key, status]) => html`<li>${accountChip(core, key)} ${statusBadge(status)}</li>`)}</ul>
<h3 class="viewer-sub">Files and their SHA-256</h3>
${table({ caption: "Files of the day", className: "table-compact", columns: [
    { label: "File", cell: (row) => html`<a href="${href({ name: "day", date, file: row.rel })}">${row.rel}</a>` },
    { label: "Size", align: "right", cell: (row) => bytes(row.bytes) },
    { label: "SHA-256", className: "col-hash", cell: (row) => html`<code class="hash">${row.sha256}</code>` },
  ], rows: files })}
<p class="muted small">This manifest's own hash is <code class="hash">${entry.sha256}</code>; the next day's manifest repeats it as its link back.</p>`,
    mount: null,
  };
}

/* Build the "visual" form of a file, or null if the file is best read raw. */
export function visualFor({ core, date, rel, text, manifest, entry }) {
  const name = rel.split("/").at(-1);
  const key = /^accounts\/([^/]+)\//.exec(rel)?.[1] ?? null;
  if (name.endsWith(".md")) return { markup: html`<div class="prose">${raw(renderMarkdown(text))}</div>`, mount: null };
  if (name.endsWith(".csv")) {
    const { header, rows } = parseCsv(text);
    if (header.join(",") !== "i,symbol,side,net,r") return null;
    return tradesVisual(core, rows.map(([i, symbol, side, net, r]) => ({ i: Number(i), symbol, side, net: Number(net), r: r === "" ? null : Number(r) })), key);
  }
  const data = safeJson(text);
  if (!data) return null;
  if (name === "day.json") return manifestVisual(core, date, data, entry);
  if (name === "desk.json" && Array.isArray(data.perAccount)) return deskVisual(core, data);
  if (name === "stars.json" && Array.isArray(data.rows)) return starsVisual(core, data);
  if (name === "summary.json") return summaryVisual(core, data);
  if (name === "trades.json" && Array.isArray(data.trades)) return tradesVisual(core, data.trades, key);
  if (name === "hours.json" && Array.isArray(data.buckets)) return hoursVisual(core, data);
  return null;
}

export function viewerHtml({ core, date, rel, file, visual, missing = false }) {
  if (missing) return html`<section class="viewer card" aria-label="File viewer"><div class="empty"><h3 class="empty-title">No such file</h3><p>${rel} is not part of ${longDate(date)}. Pick one from the list.</p></div></section>`;
  const kind = KIND_OF_PATH(rel);
  const verification = file.ok === true
    ? badge("Matches the manifest", "ok", { icon: "check", title: "The SHA-256 of these bytes, computed in your browser, equals the hash frozen with the day." })
    : file.ok === false
      ? html`<span role="alert">${badge("Does not match the manifest", "bad", { icon: "warn", title: "These bytes hash differently from what was frozen." })}</span>`
      : badge("No manifest entry to compare", "neutral", { icon: "info" });
  const mode = visual ? "visual" : "raw";
  return html`<section class="viewer card" aria-labelledby="viewer-h" data-mode="${mode}">
<header class="viewer-head">
<div class="viewer-titles"><h3 class="viewer-title" id="viewer-h"><code>${rel}</code></h3><p class="viewer-desc">${describeFile(rel)}</p></div>
<div class="viewer-tools">${visual ? segmented({ label: "How to show this file", action: "file-view", current: "visual", options: [{ value: "visual", label: "Readable" }, { value: "raw", label: "Raw" }] }) : ""}
<button type="button" class="btn btn-ghost" data-action="copy-file">${icon("copy")} Copy</button>
<a class="btn btn-ghost" href="${dayFile(date, rel)}" target="_blank" rel="noopener">${icon("external")} Raw file</a></div>
</header>
<p class="viewer-meta">${verification}<span class="meta-item">${bytes(file.size)}</span><span class="meta-item hash-inline" title="${file.actual}">SHA-256 <code>${file.actual.slice(0, 16)}…</code></span><span class="meta-item muted">${kind.toUpperCase()}</span></p>
${visual ? html`<div class="viewer-visual" data-panel="visual">${visual.markup}</div>` : ""}
<div class="viewer-raw" data-panel="raw"${visual ? raw(" hidden") : ""}>${highlight(file.text, kind)}</div>
</section>`;
}
