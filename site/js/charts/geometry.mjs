/* Chart geometry: data in, coordinates out. No DOM, so it can be tested and reasoned about.
 *
 * The time axis is the real calendar, not "one slot per row": a weekend with no closes is a
 * visible gap on the axis, and a day that was never frozen is not drawn as if it were a zero.
 * Three different things stay different: a bar (the day had closes), a quiet tick (the day was
 * frozen and nothing closed), and nothing at all (the day is missing). */

import { clamp, heatLevel, linear, maxAbs, niceTicks, pathLine, pathArea, round1 } from "../lib/scale.mjs";
import { compact, shortDate } from "../lib/fmt.mjs";

const DAY_MS = 86_400_000;
export const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
export const dateOfDayNumber = (number) => new Date(number * DAY_MS).toISOString().slice(0, 10);

const defaultMargin = { top: 14, right: 16, bottom: 30, left: 52 };

function plotArea(width, height, margin) {
  const m = { ...defaultMargin, ...margin };
  return { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom };
}

const TICK_STEPS = [1, 2, 3, 5, 7, 14, 28, 56, 91, 182, 364];

/* Date ticks a whole number of days apart, counted back from the latest day so that day is always
 * labelled: the newest figure is the one a reader looks for. */
function dateTicks(first, last, x, count) {
  const span = last - first;
  const only = (day) => ({ x: round1(x(day)), label: shortDate(dateOfDayNumber(day)), date: dateOfDayNumber(day) });
  if (span <= 0) return [only(first)];
  const step = TICK_STEPS.find((candidate) => Math.floor(span / candidate) + 1 <= count) ?? TICK_STEPS.at(-1);
  const ticks = [];
  for (let day = last; day >= first; day -= step) ticks.push(only(day));
  return ticks.reverse();
}

/* Cumulative lines over calendar days. series: [{ key, label, points: [{ date, value }] }]. */
export function curveGeometry({ series, width, height, margin = {}, xTicks = 6, area = true }) {
  const plot = plotArea(width, height, margin);
  const all = series.flatMap((line) => line.points);
  if (all.length === 0) return { width, height, plot, empty: true, lines: [], xTicks: [], yTicks: [], zeroY: null, areaD: "" };

  const days = all.map((point) => dayNumber(point.date));
  const first = Math.min(...days);
  const last = Math.max(...days);
  const pad = last === first ? 0.5 : 0.25;
  const x = linear(first - pad, last + pad, plot.x0, plot.x1);
  const values = all.map((point) => point.value).concat(0);
  const scale = niceTicks(Math.min(...values), Math.max(...values), 5);
  const y = linear(scale.min, scale.max, plot.y1, plot.y0);

  const lines = series.map((line) => {
    const points = line.points.map((point) => ({ x: round1(x(dayNumber(point.date))), y: round1(y(point.value)), date: point.date, value: point.value }));
    return { key: line.key, label: line.label, slot: line.slot ?? 0, points, d: pathLine(points), areaD: pathArea(points, y(0)) };
  });
  const dates = [...new Set(all.map((point) => point.date))].sort();
  return {
    width, height, plot, empty: false, lines, dates,
    areaD: area ? lines[0].areaD : "",
    zeroY: round1(y(0)),
    xOf: (date) => round1(x(dayNumber(date))),
    yOf: (value) => round1(y(value)),
    yTicks: scale.ticks.map((value) => ({ y: round1(y(value)), value, label: compact(value) })),
    xTicks: dateTicks(first, last, x, xTicks),
  };
}

/* One bar per calendar day. days: [{ date, value, n }] where value is the day's net and n its closes.
 * A frozen day with no closes is a "quiet" tick on the zero line; a date not in `days` is nothing. */
export function barsGeometry({ days, width, height, margin = {}, xTicks = 6 }) {
  const plot = plotArea(width, height, margin);
  if (days.length === 0) return { width, height, plot, empty: true, bars: [], quiet: [], xTicks: [], yTicks: [], zeroY: null };
  const numbers = days.map((day) => dayNumber(day.date));
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  const x = linear(first - 0.5, last + 0.5, plot.x0, plot.x1);
  const slot = (plot.x1 - plot.x0) / (last - first + 1);
  /* A bar is never thicker than 24 px and leaves a 2 px gap to its neighbour; thin slots shrink the gap. */
  const barWidth = clamp(slot - (slot > 6 ? 2 : 0.5), 1.5, 24);
  const values = days.filter((day) => day.n > 0).map((day) => day.value).concat(0);
  const scale = niceTicks(Math.min(...values), Math.max(...values), 5);
  const y = linear(scale.min, scale.max, plot.y1, plot.y0);
  const zeroY = round1(y(0));

  const bars = [];
  const quiet = [];
  const marks = [];
  days.forEach((day, index) => {
    const cx = round1(x(dayNumber(day.date)));
    if (day.n > 0 && day.value !== null) {
      const top = Math.min(y(day.value), y(0));
      const height_ = Math.max(Math.abs(y(day.value) - y(0)), day.value === 0 ? 1.5 : 0);
      bars.push({ index, date: day.date, value: day.value, n: day.n, cx, x: round1(cx - barWidth / 2), y: round1(top), width: round1(barWidth), height: round1(height_), tone: day.value > 0 ? "gain" : day.value < 0 ? "loss" : "flat" });
    } else {
      quiet.push({ index, date: day.date, x: cx, y: zeroY });
    }
    marks.push({ index, date: day.date, cx });
  });
  return {
    width, height, plot, empty: false, bars, quiet, marks, zeroY, barWidth: round1(barWidth), slot: round1(slot),
    yTicks: scale.ticks.map((value) => ({ y: round1(y(value)), value, label: compact(value) })),
    xTicks: dateTicks(first, last, x, xTicks),
  };
}

/* A month as Monday-first weeks. byDate: { 'YYYY-MM-DD': { value, n, status, crown } }. */
export function calendarGeometry({ month, byDate, seasonStart = null }) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const present = Object.values(byDate).filter((entry) => Number.isFinite(entry.value) && entry.n > 0).map((entry) => entry.value);
  const scale = maxAbs(present);
  const cells = Array.from({ length: lead }, () => ({ date: null }));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const entry = byDate[date] ?? null;
    const hasValue = entry && entry.n > 0 && Number.isFinite(entry.value);
    cells.push({
      date, day, entry,
      season: seasonStart === null || date >= seasonStart,
      level: hasValue ? heatLevel(entry.value, scale) : 0,
      tone: hasValue ? (entry.value > 0 ? "gain" : entry.value < 0 ? "loss" : "flat") : "none",
      state: entry ? (entry.n > 0 ? "closes" : "quiet") : "missing",
    });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return { month, weeks, scale };
}

/* Entry-hour histogram. buckets: [{ h: '09:00', n }] (the same label may appear twice on a 25 hour day; they add). */
export function hoursGeometry({ buckets, width, height, margin = { top: 10, right: 10, bottom: 26, left: 34 } }) {
  const plot = plotArea(width, height, margin);
  const byHour = new Map();
  for (const bucket of buckets) byHour.set(bucket.h, (byHour.get(bucket.h) ?? 0) + bucket.n);
  const labels = [...byHour.keys()].sort();
  const max = Math.max(1, ...byHour.values());
  const scale = niceTicks(0, max, 4);
  const y = linear(scale.min, scale.max, plot.y1, plot.y0);
  const slot = (plot.x1 - plot.x0) / Math.max(1, labels.length);
  const barWidth = clamp(slot - 2, 2, 24);
  const bars = labels.map((label, index) => {
    const n = byHour.get(label);
    const cx = round1(plot.x0 + index * slot + slot / 2);
    return { index, label, n, cx, x: round1(cx - barWidth / 2), y: round1(y(n)), width: round1(barWidth), height: round1(Math.max(0, y(0) - y(n))) };
  });
  return {
    width, height, plot, bars, max, baseY: round1(y(0)), total: [...byHour.values()].reduce((a, b) => a + b, 0),
    yTicks: scale.ticks.map((value) => ({ y: round1(y(value)), value, label: String(value) })),
    xLabels: labels.filter((_l, index) => index % 3 === 0).map((label) => ({ label: label.slice(0, 2), x: round1(plot.x0 + labels.indexOf(label) * slot + slot / 2) })),
  };
}

/* A sparkline path for a short list of numbers. */
export function sparkGeometry({ values, width, height, pad = 2 }) {
  if (values.length === 0) return { d: "", areaD: "", points: [] };
  const scale = niceTicks(Math.min(...values, 0), Math.max(...values, 0), 3);
  const x = linear(0, Math.max(1, values.length - 1), pad, width - pad);
  const y = linear(scale.min, scale.max, height - pad, pad);
  const points = values.map((value, index) => ({ x: round1(x(index)), y: round1(y(value)), value }));
  return { d: pathLine(points), areaD: pathArea(points, y(0)), points, zeroY: round1(y(0)) };
}
