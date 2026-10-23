/* The landing page: the whole season at a glance. */

import { html } from "../lib/html.mjs";
import { DASH, compact, int, longDate, mediumDate, money, pct, plural, profitFactor, shortDate, two, weekday } from "../lib/fmt.mjs";
import { href } from "../lib/router.mjs";
import { accountKeys, accountSeries, crownNote, dailyBars, deskSeries, entityClass, entitySlot, labelOf, lastDays, seasonTotals, tallyRow } from "../lib/model.mjs";
import { accountChip, card, chartCard, crownMark, icon, moneyHtml, segmented, statGrid, statTile, toneClass } from "../ui.mjs";
import { chartTable, barsChart, curveChart, sparkline as spark } from "../charts/draw.mjs";
import { mountChart } from "../charts/interact.mjs";

export const RANGES = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "all", label: "Season" }];
const rangeDays = (value) => (value === "all" ? 0 : Number(value));

export function describeCurve(name, rows) {
  if (rows.length === 0) return `${name}: no data yet.`;
  if (rows.length === 1) return `${name}: one day so far, ${shortDate(rows[0].date)}, at ${money(rows[0].value)}.`;
  const values = rows.map((row) => row.value);
  return `${name} from ${shortDate(rows[0].date)} to ${shortDate(rows.at(-1).date)}: starts at ${money(rows[0].value)}, ends at ${money(rows.at(-1).value)}, high ${money(Math.max(...values))}, low ${money(Math.min(...values))}.`;
}

export async function load(ctx) {
  return { core: ctx.core, range: ctx.state.range ?? "all", isolated: ctx.state.isolated ?? null };
}

function starCard(core) {
  const board = core.leaderboard.day;
  const crown = board.crown;
  const date = board.date;
  if (crown) {
    const row = board.rows.find((r) => r.key === crown.key);
    return html`<aside class="star-card" aria-labelledby="star-h">
<p class="eyebrow" id="star-h">${crownMark()} Star of the day · ${mediumDate(date)}</p>
<p class="star-name">${accountChip(core, crown.key, { label: crown.label })}</p>
<dl class="star-facts"><div><dt>Score</dt><dd class="figure">${two(crown.score)}</dd></div><div><dt>Net</dt><dd>${moneyHtml(crown.net)}</dd></div><div><dt>Closes</dt><dd class="figure">${int(row?.n)}</dd></div></dl>
<p><a class="btn" href="${href({ name: "stars", tab: "day" })}">Full leaderboard ${icon("arrow-right")}</a></p>
</aside>`;
  }
  return html`<aside class="star-card is-empty" aria-labelledby="star-h">
<p class="eyebrow" id="star-h">Star of the day · ${mediumDate(date)}</p>
<p class="star-name">No Star</p>
<p class="muted">${crownNote(board.rows)}</p>
<p><a class="btn" href="${href({ name: "stars", tab: "day" })}">See who led ${icon("arrow-right")}</a></p>
</aside>`;
}

function accountCards(core) {
  return html`<ul class="account-grid" role="list">${accountKeys(core).map((key) => {
    const report = core.reports[key];
    const series = accountSeries(core, key);
    const tally = tallyRow(core, key);
    const net = report.totals.net;
    return html`<li><a class="acct ${entityClass(core, key)}" href="${href({ name: "account", key })}">
<span class="acct-top"><span class="swatch" aria-hidden="true"></span><span class="acct-name">${report.label}</span>${tally && tally.points > 0 ? html`<span class="acct-crowns" title="${tally.points} Star points">${icon("crown")}${tally.points}<small aria-hidden="true">${tally.points === 1 ? "pt" : "pts"}</small><span class="sr-only"> Star points</span></span>` : ""}</span>
<span class="acct-net">${moneyHtml(net)}</span>
<span class="acct-meta"><span>${pct(report.totals.retPct, { signed: true })} on funding</span><span>${pct(report.totals.winRatePct)} won</span><span>PF ${profitFactor(report.totals.profitFactor, report.totals.grossWin)}</span></span>
<span class="acct-spark">${spark({ values: series.map((p) => p.value), slot: entitySlot(core, key), width: 150, height: 40 })}</span>
<span class="acct-foot">Funded ${shortDate(report.fundedDate)} · ${plural(report.totals.n, "close")}</span>
</a></li>`;
  })}</ul>`;
}

function recentDays(core) {
  const days = core.index.days.slice(-14);
  return html`<ul class="day-tiles" role="list">${days.map((day) => html`<li><a class="day-tile tone-${toneClass(day.n === 0 ? null : day.net)}" href="${href({ name: "day", date: day.date, file: null })}" aria-label="${longDate(day.date)}: ${day.n === 0 ? "no closes" : `${money(day.net)}, ${plural(day.n, "close")}`}">
<span class="day-tile-wd">${weekday(day.date)}</span><span class="day-tile-d">${Number(day.date.slice(8))}</span>
<span class="day-tile-net">${day.n === 0 ? "–" : compact(day.net)}</span>${day.crown ? html`<span class="day-tile-crown">${icon("crown")}</span>` : ""}
</a></li>`)}</ul>`;
}

/* A best or worst day; a dash and the reason when there is no such day to show. */
const dayTile = (label, entry, absent) => statTile(entry
  ? { label, value: moneyHtml(entry.net), hint: html`<a href="${href({ name: "day", date: entry.date, file: null })}">${mediumDate(entry.date)}</a>` }
  : { label, value: DASH, hint: absent });

function tallyTeaser(core) {
  const rows = [...core.crowns.tally].sort((a, b) => b.points - a.points).slice(0, 3).filter((row) => row.points > 0);
  if (rows.length === 0) return html`<p class="muted">No Star has been awarded yet.</p>`;
  return html`<ol class="tally-list">${rows.map((row, index) => html`<li>
<span class="tally-rank">${index + 1}</span>${accountChip(core, row.key, { label: row.label })}
<span class="tally-detail">${plural(row.day, "day")} · ${plural(row.week, "week")} · ${plural(row.month, "month")}</span><span class="tally-points">${row.points}<span class="sr-only"> points</span></span>
</li>`)}</ol>`;
}

export function render(model) {
  const { core, range, isolated } = model;
  const totals = seasonTotals(core);
  const rows = lastDays(deskSeries(core), rangeDays(range));
  const bars = lastDays(dailyBars(core), rangeDays(range));
  const keys = accountKeys(core);

  const filters = html`<div class="filter-row">${segmented({ label: "Time range for the charts", action: "range", options: RANGES, current: range })}</div>`;

  const curveTable = chartTable({
    caption: "Desk result by day",
    columns: [
      { label: "Day", cell: (row) => html`<a href="${href({ name: "day", date: row.date, file: null })}">${mediumDate(row.date)}</a>` },
      { label: "Closes", align: "right", cell: (row) => int(row.n) },
      { label: "That day", align: "right", cell: (row) => moneyHtml(row.net, { arrow: false }) },
      { label: "Cumulative", align: "right", cell: (row) => moneyHtml(row.value, { arrow: false }) },
    ],
    rows,
  });
  const barsTable = chartTable({
    caption: "Daily desk result",
    columns: [
      { label: "Day", cell: (row) => mediumDate(row.date) },
      { label: "Closes", align: "right", cell: (row) => int(row.n) },
      { label: "Net", align: "right", cell: (row) => (row.n === 0 ? "–" : moneyHtml(row.value, { arrow: false })) },
    ],
    rows: bars,
  });

  const legend = html`<div class="legend" role="group" aria-label="Accounts shown in the chart">${keys.map((key) => html`<button type="button" class="legend-chip ${entityClass(core, key)}" data-action="isolate" data-value="${key}" aria-pressed="${isolated === key ? "true" : "false"}"><span class="swatch" aria-hidden="true"></span>${labelOf(core, key)}</button>`)}</div>`;
  const raceRows = keys.map((key) => accountSeries(core, key));
  const raceTable = chartTable({
    caption: "Cumulative result by account",
    columns: [{ label: "Account", cell: (row) => accountChip(core, row.key, { link: false, label: row.label }) }, { label: "Since", cell: (row) => shortDate(row.since) }, { label: "Net now", align: "right", cell: (row) => moneyHtml(row.now, { arrow: false }) }],
    rows: keys.map((key, i) => ({ key, label: labelOf(core, key), since: raceRows[i][0]?.date ?? core.index.seasonStart, now: raceRows[i].at(-1)?.value ?? null })),
  });

  const markup = html`<div class="page season">
<div class="hero card glass-strong">
<div class="hero-main">
<p class="eyebrow">Season to date · ${totals.start === totals.end ? shortDate(totals.start) : `${shortDate(totals.start)} – ${shortDate(totals.end)}`} ${totals.end.slice(0, 4)}</p>
<h1 class="page-title" tabindex="-1">The desk so far</h1>
<p class="hero-figure ${toneClass(totals.net)}"><span class="sr-only">Desk net since the start of the season: </span>${moneyHtml(totals.net)}<span class="unit">EUR</span></p>
<p class="hero-caption">Net result of ${plural(keys.length, "demo account")} over ${plural(totals.frozen, "frozen day")} and ${plural(totals.closes, "closed trade")}. Simulated money, not advice.</p>
</div>
${starCard(core)}
</div>

${statGrid(html`
${statTile({ label: "Frozen days", value: int(totals.frozen), hint: `since ${shortDate(totals.start)}` })}
${statTile({ label: "Closed trades", value: int(totals.closes), hint: `${plural(totals.active, "day")} with trades` })}
${dayTile("Best day", totals.best, "no day with trades yet")}
${dayTile("Worst day", totals.worst, "needs a second day with trades")}
`, "stats-4")}

${chartCard({ id: "desk-curve", title: "Desk result, cumulative", subtitle: describeCurve("Desk", rows), table: curveTable, label: "Desk cumulative result by day. Use the arrow keys to step through the days.", filters })}
${chartCard({ id: "desk-bars", title: "Daily result", subtitle: "One column per calendar day. A short tick on the line is a day that was frozen with no closes.", table: barsTable, label: "Daily desk result. Use the arrow keys to step through the days." })}

${card({ id: "accounts", title: "The accounts", subtitle: "Each account keeps its colour on every page. Open one for its full record.", body: accountCards(core), className: "card-accounts" })}

${chartCard({ id: "race", title: "Account race", subtitle: "Cumulative result of each account since it was funded. Choose a name to isolate its line.", legend, table: raceTable, label: "Cumulative result of each account. Use the arrow keys to step through the days." })}

<div class="grid-2">
${card({ id: "recent", title: "Recent days", subtitle: "Colour is the day's net; the crown marks a Star.", body: recentDays(core), actions: html`<a class="btn btn-ghost" href="${href({ name: "calendar", month: null })}">Calendar ${icon("arrow-right")}</a>` })}
${card({ id: "tally", title: "Star tally", subtitle: "Points: 1 for a day, 5 for a week, 20 for a month.", body: tallyTeaser(core), actions: html`<a class="btn btn-ghost" href="${href({ name: "stars", tab: "all" })}">All-time ${icon("arrow-right")}</a>` })}
</div>
</div>`;

  return {
    title: "Season",
    markup,
    after(root) {
      const total = seasonTotals(core);
      mountChart(root.querySelector("#desk-curve-box"), (width) => curveChart({
        uid: "deskcurve", width, title: "Desk cumulative result", description: describeCurve("Desk", rows),
        series: [{ key: "desk", label: "Desk", slot: 0, points: rows.map((row) => ({ date: row.date, value: row.value })) }],
        extraRows: (date) => { const row = rows.find((r) => r.date === date); return row ? [{ label: `${plural(row.n, "close")} that day`, value: money(row.net) }] : []; },
      }));
      mountChart(root.querySelector("#desk-bars-box"), (width) => barsChart({ uid: "deskbars", width, title: "Daily desk result", description: `Daily desk result for ${plural(bars.length, "day")}, ${money(total.net)} in all.`, days: bars }));
      mountChart(root.querySelector("#race-box"), (width) => curveChart({
        uid: "race", width, height: 300, title: "Cumulative result by account", description: "One line per account; the legend names each.", isolated,
        series: keys.map((key) => ({ key, label: labelOf(core, key), slot: entitySlot(core, key), points: lastDays(accountSeries(core, key), rangeDays(range)).map((p) => ({ date: p.date, value: p.value })) })).filter((s) => s.points.length > 0),
      }));
    },
  };
}
