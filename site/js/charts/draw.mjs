/* Chart markup: geometry in, SVG text out. Pure (no DOM), so every chart is testable and the same
 * code draws it in the browser and in a test.
 *
 * Mark specs: lines 2 px with round joins; end dots at least 8 px with a 2 px ring of the surface
 * colour; areas are a wash, never a block; gridlines are solid hairlines; bars are at most 24 px
 * thick, rounded (4 px) at the data end and square at the baseline. Text uses text tokens, never
 * the series colour: identity comes from the coloured mark beside it.
 *
 * Each builder returns { markup, model }. `model` is what the pointer/keyboard layer needs to
 * place a cursor and a tooltip: it is plain data plus an `at(i)` function. */

import { html, join, raw } from "../lib/html.mjs";
import { DASH, compact, int, longDate, money, shortDate } from "../lib/fmt.mjs";
import { barsGeometry, curveGeometry, hoursGeometry, sparkGeometry } from "./geometry.mjs";

const ticksFor = (width) => (width < 420 ? 4 : width < 720 ? 6 : 8);
const slotClass = (slot) => (slot ? `ent-${slot}` : "ink");
/* Columns that belong to no account (the whole desk) wear the brand hue, not an account's colour. */
const hueClass = (slot) => (slot ? `ent-${slot}` : "brand");

function openSvg(uid, width, height, title, description) {
  return `<svg class="svg-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${uid}-t ${uid}-d" focusable="false">`;
}

function frame(geometry) {
  const { plot, yTicks, xTicks } = geometry;
  return html`<g class="grid" aria-hidden="true">${yTicks.map((tick) => html`<line x1="${plot.x0}" x2="${plot.x1}" y1="${tick.y}" y2="${tick.y}"/>`)}</g>
<g class="axis axis-y" aria-hidden="true">${yTicks.map((tick) => html`<text x="${plot.x0 - 8}" y="${tick.y}" dy="0.32em" text-anchor="end">${tick.label}</text>`)}</g>
<g class="axis axis-x" aria-hidden="true">${xTicks.map((tick) => html`<text x="${tick.x}" y="${plot.y1 + 20}" text-anchor="middle">${tick.label}</text>`)}</g>`;
}

export function emptyChart(message = "Nothing to draw yet") {
  return { markup: html`<p class="chart-empty">${message}</p>`, model: null };
}

/* A cumulative curve. `series`: [{ key, label, slot, points: [{ date, value }] }]. One series is drawn
 * in ink with a gain/loss wash either side of zero; several are drawn in their account colours. */
export function curveChart({ uid, title, description, series, width, height = 260, isolated = null, extraRows = null }) {
  const geometry = curveGeometry({ series, width, height, margin: { left: 50, right: 24 }, xTicks: ticksFor(width), area: series.length === 1 });
  if (geometry.empty) return emptyChart();
  const single = series.length === 1;
  const { plot, zeroY } = geometry;
  const dim = (line) => isolated !== null && line.key !== isolated;

  const washes = single
    ? html`<defs>
  <clipPath id="${uid}-up"><rect x="0" y="0" width="${width}" height="${Math.max(0, zeroY)}"/></clipPath>
  <clipPath id="${uid}-down"><rect x="0" y="${zeroY}" width="${width}" height="${Math.max(0, height - zeroY)}"/></clipPath>
  <linearGradient id="${uid}-gup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-gain-top"/><stop offset="1" class="stop-gain-bottom"/></linearGradient>
  <linearGradient id="${uid}-gdown" x1="0" y1="1" x2="0" y2="0"><stop offset="0" class="stop-loss-top"/><stop offset="1" class="stop-loss-bottom"/></linearGradient>
</defs>
<path class="wash" d="${geometry.areaD}" fill="url(#${uid}-gup)" clip-path="url(#${uid}-up)"/>
<path class="wash" d="${geometry.areaD}" fill="url(#${uid}-gdown)" clip-path="url(#${uid}-down)"/>`
    : "";

  /* One series is ink unless it belongs to an account, in which case it keeps that account's colour. */
  const lineClass = (line) => (single && !line.slot ? "line-ink" : `stroke-${slotClass(line.slot)}`);
  const dotClass = (line) => (single && !line.slot ? "dot-ink" : `fill-${slotClass(line.slot)}`);
  const paths = geometry.lines.map((line) => html`<path class="line ${lineClass(line)}${dim(line) ? " is-dim" : ""}" d="${line.d}"/>`);
  const ends = geometry.lines.filter((line) => line.points.length > 0 && !dim(line)).map((line) => {
    const last = line.points.at(-1);
    return html`<circle class="end-dot ${dotClass(line)}" cx="${last.x}" cy="${last.y}" r="4.5"/>`;
  });
  const lastPoint = geometry.lines[0].points.at(-1);
  const endLabel = single && lastPoint
    ? html`<text class="end-label" x="${Math.min(lastPoint.x, plot.x1)}" y="${lastPoint.y + (lastPoint.value >= 0 ? -12 : 20)}" text-anchor="end">${money(lastPoint.value)}</text>`
    : "";
  const cursorDots = geometry.lines.map((line) => html`<circle class="cursor-dot ${dotClass(line)}" data-key="${line.key}" r="5" cx="0" cy="0" hidden/>`);

  const markup = html`${raw(openSvg(uid, width, height))}<title id="${uid}-t">${title}</title><desc id="${uid}-d">${description}</desc>
${washes}${frame(geometry)}
<line class="baseline" x1="${plot.x0}" x2="${plot.x1}" y1="${zeroY}" y2="${zeroY}"/>
${paths}${ends}${endLabel}
<g class="cursor" aria-hidden="true"><line class="cursor-line" x1="0" x2="0" y1="${plot.y0}" y2="${plot.y1}"/>${cursorDots}</g>
</svg>`;

  const xs = geometry.dates.map((date) => geometry.xOf(date));
  const model = {
    kind: "curve", width, height, plot, xs, count: xs.length,
    at(index) {
      const date = geometry.dates[index];
      const rows = geometry.lines
        .map((line) => {
          const point = line.points.find((p) => p.date === date);
          return point ? { key: line.key, label: line.label, slot: line.slot, value: point.value, y: point.y } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.value - a.value);
      const extra = extraRows ? extraRows(date) : [];
      const tip = html`<div class="tip-date">${longDate(date)}</div>
${rows.map((row) => html`<div class="tip-row"><span class="tip-key key-${slotClass(row.slot)}" aria-hidden="true"></span><span class="tip-value">${money(row.value)}</span><span class="tip-name">${row.label}</span></div>`)}
${extra.map((row) => html`<div class="tip-row tip-extra"><span class="tip-value">${row.value}</span><span class="tip-name">${row.label}</span></div>`)}`;
      const speak = `${longDate(date)}. ${rows.map((row) => `${row.label} ${money(row.value)}`).join(". ")}`;
      return { index, date, x: xs[index], tipY: Math.min(...rows.map((row) => row.y), plot.y1), dots: rows.map((row) => ({ key: row.key, cy: row.y })), tip, speak };
    },
  };
  return { markup, model };
}

/* Rounded at the data end only, square at the baseline. */
export function barPath(x, y, w, h, up, radius = 4) {
  const r = Math.min(radius, w / 2, h);
  if (r <= 0.5) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  if (up) return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
  return `M${x} ${y}H${x + w}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}Z`;
}

/* One column per calendar day. `days`: [{ date, value, n }]. A quiet day is a tick on the baseline;
 * a day that was never frozen is simply absent. Only the best and worst bars carry a value label. */
export function barsChart({ uid, title, description, days, width, height = 220, slot = 0, noun = "closes" }) {
  const geometry = barsGeometry({ days, width, height, margin: { left: 50, right: 22 }, xTicks: ticksFor(width) });
  if (geometry.empty) return emptyChart();
  const { plot, zeroY } = geometry;
  const best = geometry.bars.reduce((top, bar) => (bar.value > 0 && (!top || bar.value > top.value) ? bar : top), null);
  const worst = geometry.bars.reduce((low, bar) => (bar.value < 0 && (!low || bar.value < low.value) ? bar : low), null);

  const bars = geometry.bars.map((bar) => html`<path class="bar ${bar.tone}" data-i="${bar.index}" d="${barPath(bar.x, bar.y, bar.width, bar.height, bar.value >= 0)}"/>`);
  const quiet = geometry.quiet.map((tick) => html`<line class="quiet" data-i="${tick.index}" x1="${tick.x - 4}" x2="${tick.x + 4}" y1="${tick.y}" y2="${tick.y}"/>`);
  const labels = [best, worst].filter(Boolean).map((bar) => {
    const above = bar.value >= 0;
    const y = above ? bar.y - 6 : bar.y + bar.height + 14;
    return html`<text class="bar-label" x="${Math.min(Math.max(bar.cx, plot.x0 + 14), plot.x1 - 14)}" y="${y}" text-anchor="middle">${money(bar.value)}</text>`;
  });

  const markup = html`${raw(openSvg(uid, width, height))}<title id="${uid}-t">${title}</title><desc id="${uid}-d">${description}</desc>
${frame(geometry)}
<line class="baseline" x1="${plot.x0}" x2="${plot.x1}" y1="${zeroY}" y2="${zeroY}"/>
${bars}${quiet}${labels}
<g class="cursor" aria-hidden="true"><line class="cursor-line cursor-soft" x1="0" x2="0" y1="${plot.y0}" y2="${plot.y1}"/></g>
</svg>`;

  const byIndex = new Map(days.map((day, index) => [index, day]));
  const model = {
    kind: "bars", width, height, plot, xs: geometry.marks.map((mark) => mark.cx), count: geometry.marks.length,
    at(index) {
      const day = byIndex.get(index);
      const closes = day.n === 0 ? "No closes" : `${int(day.n)} ${day.n === 1 ? noun.replace(/s$/, "") : noun}`;
      const tip = html`<div class="tip-date">${longDate(day.date)}</div>
<div class="tip-row"><span class="tip-key key-${slotClass(slot)}" aria-hidden="true"></span><span class="tip-value">${day.n === 0 ? DASH : money(day.value)}</span><span class="tip-name">${closes}</span></div>`;
      return { index, date: day.date, x: geometry.marks[index].cx, tipY: plot.y0 + 8, dots: [], tip, speak: `${longDate(day.date)}. ${day.n === 0 ? "No closes" : `${money(day.value)}, ${closes}`}` };
    },
  };
  return { markup, model };
}

/* Entry hours as columns. `buckets`: [{ h: '09:00', n }]. */
export function hoursChart({ uid, title, description, buckets, width, height = 170, slot = 0, noun = "trades" }) {
  const geometry = hoursGeometry({ buckets, width, height, margin: { top: 12, right: 12, bottom: 26, left: 34 } });
  if (geometry.total === 0) return emptyChart("No trades to place on the clock");
  const { plot } = geometry;
  const peak = geometry.bars.reduce((top, bar) => (bar.n > (top?.n ?? 0) ? bar : top), null);

  const bars = geometry.bars.map((bar) => (bar.n > 0
    ? html`<path class="bar bar-${hueClass(slot)}" data-i="${bar.index}" d="${barPath(bar.x, bar.y, bar.width, bar.height, true)}"/>`
    : html`<line class="quiet" data-i="${bar.index}" x1="${bar.x}" x2="${bar.x + bar.width}" y1="${geometry.baseY}" y2="${geometry.baseY}"/>`));
  const peakLabel = peak ? html`<text class="bar-label" x="${Math.min(Math.max(peak.cx, plot.x0 + 10), plot.x1 - 10)}" y="${peak.y - 6}" text-anchor="middle">${int(peak.n)}</text>` : "";

  const markup = html`${raw(openSvg(uid, width, height))}<title id="${uid}-t">${title}</title><desc id="${uid}-d">${description}</desc>
<g class="grid" aria-hidden="true">${geometry.yTicks.map((tick) => html`<line x1="${plot.x0}" x2="${plot.x1}" y1="${tick.y}" y2="${tick.y}"/>`)}</g>
<g class="axis axis-y" aria-hidden="true">${geometry.yTicks.map((tick) => html`<text x="${plot.x0 - 8}" y="${tick.y}" dy="0.32em" text-anchor="end">${tick.label}</text>`)}</g>
<g class="axis axis-x" aria-hidden="true">${geometry.xLabels.map((label) => html`<text x="${label.x}" y="${plot.y1 + 18}" text-anchor="middle">${label.label}</text>`)}</g>
<line class="baseline" x1="${plot.x0}" x2="${plot.x1}" y1="${geometry.baseY}" y2="${geometry.baseY}"/>
${bars}${peakLabel}
<g class="cursor" aria-hidden="true"><line class="cursor-line cursor-soft" x1="0" x2="0" y1="${plot.y0}" y2="${plot.y1}"/></g>
</svg>`;

  const model = {
    kind: "bars", width, height, plot, xs: geometry.bars.map((bar) => bar.cx), count: geometry.bars.length,
    at(index) {
      const bar = geometry.bars[index];
      const hour = Number(bar.label.slice(0, 2));
      const range = `${bar.label}${DASH}${String((hour + 1) % 24).padStart(2, "0")}:00`;
      const what = `${int(bar.n)} ${bar.n === 1 ? noun.replace(/s$/, "") : noun} placed`;
      const tip = html`<div class="tip-date">${range}</div>
<div class="tip-row"><span class="tip-key key-${hueClass(slot)}" aria-hidden="true"></span><span class="tip-value">${int(bar.n)}</span><span class="tip-name">${noun} placed</span></div>`;
      return { index, date: null, x: bar.cx, tipY: plot.y0 + 8, dots: [], tip, speak: `${range}. ${what}` };
    },
  };
  return { markup, model };
}

/* A small static trend line for a card. Decorative: the figure beside it carries the meaning. */
export function sparkline({ values, width = 120, height = 36, slot = 0, tone = null }) {
  if (values.length < 2) return html`<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false"><line class="baseline" x1="2" x2="${width - 2}" y1="${height / 2}" y2="${height / 2}"/></svg>`;
  const geometry = sparkGeometry({ values, width, height, pad: 5 });
  const last = geometry.points.at(-1);
  const colour = tone ? `line-${tone}` : `stroke-${slotClass(slot)}`;
  const dot = tone ? `dot-${tone}` : `fill-${slotClass(slot)}`;
  return html`<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">
<line class="baseline" x1="2" x2="${width - 2}" y1="${geometry.zeroY}" y2="${geometry.zeroY}"/>
<path class="line ${colour}" d="${geometry.d}"/>
<circle class="end-dot ${dot}" cx="${last.x}" cy="${last.y}" r="4"/>
</svg>`;
}

/* The table twin of a chart: every value the picture shows, readable without it. */
export function chartTable({ caption, columns, rows }) {
  return html`<div class="table-wrap"><table class="table table-compact">
<caption class="sr-only">${caption}</caption>
<thead><tr>${columns.map((column) => html`<th scope="col" class="${column.align ?? "left"}">${column.label}</th>`)}</tr></thead>
<tbody>${rows.map((row) => html`<tr>${columns.map((column) => html`<td class="${column.align ?? "left"}">${column.cell(row)}</td>`)}</tr>`)}</tbody>
</table></div>`;
}

export { compact, join, shortDate };
