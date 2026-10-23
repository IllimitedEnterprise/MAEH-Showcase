/* One account: its whole record since it was funded. */

import { html, raw } from "../lib/html.mjs";
import { DASH, int, mediumDate, money, pct, periodLabel, profitFactor, two } from "../lib/fmt.mjs";
import { href } from "../lib/router.mjs";
import { renderMarkdown } from "../lib/markdown.mjs";
import { accountSeries, dailyBars, entityClass, entitySlot, labelOf, tallyRow } from "../lib/model.mjs";
import { badge, card, chartCard, crownMark, emptyState, icon, moneyHtml, pageHead, statGrid, statTile, statusBadge, table, toneClass } from "../ui.mjs";
import { barsChart, chartTable, curveChart, hoursChart } from "../charts/draw.mjs";
import { mountChart } from "../charts/interact.mjs";
import { describeCurve } from "./season.mjs";

export async function load(ctx, route) {
  const { core, data } = ctx;
  /* hasOwn: a name like __proto__ or constructor must not find something on Object.prototype */
  const report = Object.hasOwn(core.reports, route.key) ? core.reports[route.key] : null;
  if (!report) return { core, key: route.key, missing: true };
  let markdown = "";
  try {
    markdown = await data.text(`stars/accounts/${route.key}.md`);
  } catch {
    markdown = "";
  }
  return { core, key: route.key, report, markdown };
}

function symbols(report) {
  const pairs = [...report.pairs].sort((a, b) => b.net - a.net);
  const top = Math.max(1, ...pairs.map((pair) => Math.abs(pair.net)));
  const row = (pair) => html`<li><span class="bl-name">${pair.symbol}</span><span class="bl-n">${int(pair.n)}×</span><span class="bl-bar"><span class="bl-fill ${pair.net >= 0 ? "gain" : "loss"}" data-style="--w:${Math.max(2, Math.round((Math.abs(pair.net) / top) * 100))}%"></span></span><span class="bl-val">${moneyHtml(pair.net, { arrow: false })}</span></li>`;
  const head = pairs.slice(0, 8);
  const rest = pairs.slice(8);
  return html`<ul class="bars-list" role="list">${head.map(row)}</ul>${rest.length ? html`<details class="data-details"><summary>${rest.length} more symbols</summary><ul class="bars-list" role="list">${rest.map(row)}</ul></details>` : ""}`;
}

function awards(core, key) {
  const mine = core.crowns.awards.filter((award) => award.key === key);
  if (mine.length === 0) return html`<p class="muted">No Star yet. A crown goes to the top-ranked account of a day, week or month, and only if it finished in profit.</p>`;
  const link = (award) => (award.kind === "day" ? href({ name: "day", date: award.period, file: null }) : href({ name: "stars", tab: award.kind }));
  return html`<ul class="award-list" role="list">${mine.map((award) => html`<li><span class="award-kind award-${award.kind}">${award.kind === "day" ? "Day" : award.kind === "week" ? "Week" : "Month"}</span>
<a class="award-period" href="${link(award)}">${award.kind === "day" ? mediumDate(award.period) : periodLabel(award.kind, award.period)}</a>
<span class="award-score">score ${two(award.score)}</span>${moneyHtml(award.net, { arrow: false })}${award.partialPeriod ? badge("Partial period", "neutral", { title: "The period began before the season did." }) : ""}</li>`)}</ul>`;
}

export function render(model) {
  const { core, key, report, markdown } = model;
  if (model.missing) {
    return { title: "Account", markup: html`<div class="page">${pageHead({ eyebrow: "Account", title: key })}${emptyState("No such account", "That name is not one of the season's accounts.", html`<p><a class="btn" href="${href({ name: "season" })}">Back to the season</a></p>`)}</div>`, after() {} };
  }
  const slot = entitySlot(core, key);
  const t = report.totals;
  const series = accountSeries(core, key);
  const bars = dailyBars(core, key);
  const form = report.form.filter((row) => row.status !== "prefunding");
  const tally = tallyRow(core, key);

  const curveTable = chartTable({
    caption: `${report.label}: result by day`,
    columns: [
      { label: "Day", cell: (row) => html`<a href="${href({ name: "day", date: row.date, file: null })}">${mediumDate(row.date)}</a>` },
      { label: "Closes", align: "right", cell: (row) => int(row.n) },
      { label: "That day", align: "right", cell: (row) => moneyHtml(row.net, { arrow: false }) },
      { label: "Cumulative", align: "right", cell: (row) => moneyHtml(row.value, { arrow: false }) },
    ],
    rows: series,
  });
  const barsTable = chartTable({
    caption: `${report.label}: daily result`,
    columns: [{ label: "Day", cell: (row) => mediumDate(row.date) }, { label: "Closes", align: "right", cell: (row) => int(row.n) }, { label: "Net", align: "right", cell: (row) => (row.n === 0 ? DASH : moneyHtml(row.value, { arrow: false })) }],
    rows: bars,
  });

  const formTable = table({
    caption: `${report.label}: day by day`,
    className: "table-compact",
    columns: [
      { label: "Day", cell: (row) => html`<a href="${href({ name: "day", date: row.date, file: null })}">${mediumDate(row.date)}</a>` },
      { label: "Status", className: "col-optional", cell: (row) => statusBadge(row.status) },
      { label: "Closes", align: "right", cell: (row) => int(row.n) },
      { label: "Net", align: "right", cell: (row) => (row.n === 0 ? DASH : moneyHtml(row.net, { arrow: false })) },
      { label: "Rank", align: "right", cell: (row) => (row.rank === null ? DASH : row.rank) },
      { label: "Score", align: "right", className: "col-optional", cell: (row) => (row.score === null ? DASH : two(row.score)) },
      { label: "Star", align: "right", cell: (row) => (row.crowned ? crownMark() : "") },
    ],
    rows: [...form].reverse(),
  });

  const markup = html`<div class="page account ${entityClass(core, key)}">
<div class="hero card glass-strong">
<div class="hero-main">
<p class="eyebrow"><a href="${href({ name: "season" })}">Season</a> · Account · funded ${mediumDate(report.fundedDate)}</p>
<h1 class="page-title account-title" tabindex="-1"><span class="swatch swatch-lg" aria-hidden="true"></span>${report.label}</h1>
<p class="hero-figure ${toneClass(t.net)}"><span class="sr-only">Net since funding: </span>${moneyHtml(t.net)}<span class="unit">EUR</span></p>
<p class="hero-caption">${pct(t.retPct, { signed: true, digits: 2 })} on its funding · ${int(t.n)} closes over ${int(t.activeDays)} active ${t.activeDays === 1 ? "day" : "days"} of ${int(t.days)}</p>
</div>
<aside class="star-card ${tally && tally.points > 0 ? "" : "is-empty"}" aria-labelledby="stars-h">
<p class="eyebrow" id="stars-h">${crownMark()} Stars</p>
<p class="star-name"><span class="figure-xl">${int(report.crowns.points)}</span> <span class="muted">points</span></p>
<dl class="star-facts"><div><dt>Day</dt><dd class="figure">${int(report.crowns.day)}</dd></div><div><dt>Week</dt><dd class="figure">${int(report.crowns.week)}</dd></div><div><dt>Month</dt><dd class="figure">${int(report.crowns.month)}</dd></div></dl>
<p class="muted small">${report.crowns.streak.best > 0 ? `Longest run of day Stars: ${report.crowns.streak.best}${report.crowns.streak.cur > 0 ? `, running now at ${report.crowns.streak.cur}` : ""}.` : "No day-Star run yet."}</p>
</aside>
</div>

${statGrid(html`
${statTile({ label: "Win rate", value: pct(t.winRatePct), hint: `${int(t.wins)} won · ${int(t.losses)} lost · ${int(t.breakevens)} even` })}
${statTile({ label: "Profit factor", value: profitFactor(t.profitFactor, t.grossWin), hint: `${two(t.grossWin)} won vs ${two(t.grossLoss)} lost` })}
${statTile({ label: "Deepest fall", value: two(t.maxDrawdown), hint: `${pct(t.ddPct, { digits: 2 })} of funding` })}
${statTile({ label: "Best day", value: report.bestDay ? moneyHtml(report.bestDay.net) : DASH, hint: report.bestDay ? html`<a href="${href({ name: "day", date: report.bestDay.date, file: null })}">${mediumDate(report.bestDay.date)}</a>` : null })}
${statTile({ label: "Worst day", value: report.worstDay ? moneyHtml(report.worstDay.net) : DASH, hint: report.worstDay ? html`<a href="${href({ name: "day", date: report.worstDay.date, file: null })}">${mediumDate(report.worstDay.date)}</a>` : null })}
${statTile({ label: "Longest runs", value: `${t.streaks.maxWins} / ${t.streaks.maxLosses}`, hint: "wins / losses in a row" })}`, "stats-6")}

${chartCard({ id: "acct-curve", title: "Result since funding", subtitle: describeCurve(report.label, series), table: curveTable, label: `${report.label}: cumulative result by day. Use the arrow keys to step through the days.` })}
${chartCard({ id: "acct-bars", title: "Daily result", subtitle: "One column per calendar day; a tick on the line is a day with no closes.", table: barsTable, label: `${report.label}: daily result. Use the arrow keys to step through the days.`, className: "" })}

<div class="grid-2">
${card({ id: "acct-symbols", title: "Where the result came from", subtitle: "Net result by symbol since funding, best first.", body: symbols(report) })}
${card({ id: "acct-hours", title: "When trades were opened", subtitle: "All of this account's closed trades, by the hour they were opened.", body: html`<div class="chart-box" id="acct-hours-box" tabindex="0" role="group" aria-label="Entry hours. Use the arrow keys to step through the hours."></div>` })}
</div>

${card({ id: "acct-stars", title: "Stars won", body: awards(core, key), actions: html`<a class="btn btn-ghost" href="${href({ name: "stars", tab: "all" })}">All-time tally ${icon("arrow-right")}</a>` })}
${card({ id: "acct-form", title: "Day by day", subtitle: "Newest first. Rank and score are against the other accounts that day.", body: formTable })}
${markdown ? card({ id: "acct-report", title: "The written report", subtitle: `stars/accounts/${key}.md`, body: html`<div class="prose">${raw(renderMarkdown(markdown))}</div>` }) : ""}
</div>`;

  return {
    title: report.label,
    markup,
    after(root) {
      mountChart(root.querySelector("#acct-curve-box"), (width) => curveChart({
        uid: "acctcurve", width, title: `${report.label}: cumulative result`, description: describeCurve(report.label, series),
        series: [{ key, label: report.label, slot, points: series.map((row) => ({ date: row.date, value: row.value })) }],
        extraRows: (date) => { const row = series.find((r) => r.date === date); return row ? [{ label: `${int(row.n)} closes that day`, value: money(row.net) }] : []; },
      }));
      mountChart(root.querySelector("#acct-bars-box"), (width) => barsChart({ uid: "acctbars", width, title: `${report.label}: daily result`, description: `Daily result for ${bars.length} days.`, days: bars, slot }));
      mountChart(root.querySelector("#acct-hours-box"), (width) => hoursChart({ uid: "accthours", width, title: "Entry hours", description: `${int(report.hours.total)} closed trades by the hour they were opened.`, buckets: report.hours.buckets, slot }));
    },
  };
}
