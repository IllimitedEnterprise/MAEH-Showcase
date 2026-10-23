/* A month as a grid of days, each coloured by the desk's net for that day. */

import { html } from "../lib/html.mjs";
import { DASH, compact, int, longDate, mediumDate, monthTitle } from "../lib/fmt.mjs";
import { href } from "../lib/router.mjs";
import { isoWeek, labelOf, monthsAvailable, shiftMonth } from "../lib/model.mjs";
import { badge, card, icon, moneyHtml, pageHead, statGrid, statTile } from "../ui.mjs";
import { calendarGeometry } from "../charts/geometry.mjs";

export async function load(ctx, route) {
  const { core } = ctx;
  const months = monthsAvailable(core);
  const month = route.month ?? months.at(-1) ?? core.index.seasonStart.slice(0, 7);
  const byDate = {};
  for (const day of core.index.days) byDate[day.date] = { value: day.net, n: day.n, status: day.status, crown: day.crown, kind: day.kind };
  return { core, month, months, byDate };
}

const monthLink = (month) => href({ name: "calendar", month });

function cellLabel(core, cell) {
  if (cell.state === "missing") return `${longDate(cell.date)}: not frozen`;
  const entry = cell.entry;
  const parts = [cell.state === "quiet" ? "no closes" : `${moneyText(entry.value)}, ${int(entry.n)} closes`];
  if (entry.crown) parts.push(`Star ${labelOf(core, entry.crown)}`);
  if (entry.status !== "complete") parts.push(entry.status);
  return `${longDate(cell.date)}: ${parts.join(", ")}`;
}

const moneyText = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;

function cellHtml(core, cell, latest) {
  if (cell.date === null) return html`<td class="cal-pad"></td>`;
  const out = !cell.season || cell.date > latest;
  if (cell.state === "missing") {
    return html`<td><span class="cal-cell ${out ? "is-off" : "is-missing"}"${out ? "" : html` title="Not frozen"`}><span class="cal-day">${cell.day}</span>${out ? "" : html`<span class="cal-net">${DASH}</span><span class="sr-only">${longDate(cell.date)}: not frozen</span>`}</span></td>`;
  }
  const entry = cell.entry;
  return html`<td><a class="cal-cell tone-${cell.tone} level-${cell.level}${cell.state === "quiet" ? " is-quiet" : ""}" href="${href({ name: "day", date: cell.date, file: null })}" aria-label="${cellLabel(core, cell)}">
<span class="cal-day">${cell.day}</span>${entry.crown ? html`<span class="cal-crown" title="Star: ${labelOf(core, entry.crown)}">${icon("crown")}</span>` : ""}
<span class="cal-net">${cell.state === "quiet" ? DASH : compact(entry.value)}</span><span class="cal-n">${cell.state === "quiet" ? "no closes" : `${int(entry.n)} closes`}</span>
</a></td>`;
}

export function render(model) {
  const { core, month, months, byDate } = model;
  const latest = core.index.days.at(-1)?.date ?? "";
  const geometry = calendarGeometry({ month, byDate, seasonStart: core.index.seasonStart });
  const first = months[0] ?? month;
  const last = months.at(-1) ?? month;

  const inMonth = core.index.days.filter((day) => day.date.startsWith(month));
  const net = Math.round(inMonth.reduce((sum, day) => sum + day.net, 0) * 100) / 100;
  const closes = inMonth.reduce((sum, day) => sum + day.n, 0);
  const stars = inMonth.filter((day) => day.crown).length;
  const weekAward = (date) => core.crowns.periods.find((p) => p.kind === "week" && p.period === isoWeek(date));

  const rows = geometry.weeks.map((week) => {
    const dated = week.filter((cell) => cell.date);
    const entries = dated.map((cell) => cell.entry).filter((entry) => entry && entry.n > 0);
    const weekNet = Math.round(entries.reduce((sum, entry) => sum + entry.value, 0) * 100) / 100;
    const anchor = dated[0]?.date;
    const inSeason = dated.some((cell) => cell.season && cell.date <= latest);
    const award = anchor && inSeason ? weekAward(anchor) : null;
    return html`<tr>${week.map((cell) => cellHtml(core, cell, latest))}
<td class="cal-week">${anchor && inSeason ? html`<span class="cal-week-id">W${isoWeek(anchor).slice(6)}</span>${award?.crown ? html`<span class="cal-week-crown" title="Week Star: ${award.crown.label}">${icon("crown")}</span>` : ""}<span class="cal-week-net">${entries.length ? compact(weekNet) : DASH}</span>` : ""}</td></tr>`;
  });

  const markup = html`<div class="page calendar">
${pageHead({
    eyebrow: "Calendar",
    title: monthTitle(month),
    lede: "Every square is a day. Green and red are the desk's net, deeper for bigger days; a crown is that day's Star. Open a day for its files.",
    actions: months.length > 1 || month !== last ? html`<nav class="month-nav" aria-label="Choose a month">
${month > first ? html`<a class="btn btn-ghost" href="${monthLink(shiftMonth(month, -1))}">${icon("chevron-left")} ${monthTitle(shiftMonth(month, -1))}</a>` : html`<span class="btn btn-ghost is-disabled" aria-disabled="true">${icon("chevron-left")} Earlier</span>`}
${month !== last ? html`<a class="btn btn-ghost" href="${href({ name: "calendar", month: null })}">Latest</a>` : ""}
${month < last ? html`<a class="btn btn-ghost" href="${monthLink(shiftMonth(month, 1))}">${monthTitle(shiftMonth(month, 1))} ${icon("chevron-right")}</a>` : html`<span class="btn btn-ghost is-disabled" aria-disabled="true">Later ${icon("chevron-right")}</span>`}
</nav>` : null,
  })}
${statGrid(html`
${statTile({ label: "Month net", value: inMonth.length ? moneyHtml(net) : DASH })}
${statTile({ label: "Frozen days", value: int(inMonth.length) })}
${statTile({ label: "Closed trades", value: int(closes) })}
${statTile({ label: "Day Stars", value: int(stars) })}`, "stats-4")}
${card({
    id: "grid", title: "Desk net, day by day", className: "card-calendar",
    subtitle: inMonth.length === 0 ? "No days were frozen in this month." : `${inMonth.length} ${inMonth.length === 1 ? "day" : "days"} frozen, last ${mediumDate(inMonth.at(-1).date)}.`,
    body: html`<div class="table-wrap cal-wrap"><table class="cal">
<caption class="sr-only">${monthTitle(month)}: desk net per day</caption>
<thead><tr>${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((name) => html`<th scope="col"><abbr title="${name}">${name.slice(0, 3)}</abbr></th>`)}<th scope="col" class="cal-week-h">Week</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div class="cal-legend" aria-hidden="true"><span>Loss</span><span class="cal-swatch tone-loss level-4"></span><span class="cal-swatch tone-loss level-2"></span><span class="cal-swatch tone-flat level-0"></span><span class="cal-swatch tone-gain level-2"></span><span class="cal-swatch tone-gain level-4"></span><span>Gain</span><span class="cal-swatch is-missing"></span><span>Not frozen</span></div>`,
  })}
</div>`;
  return { title: monthTitle(month), markup, after() {} };
}
