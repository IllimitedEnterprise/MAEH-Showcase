/* Scales, ticks and path strings for the hand-drawn charts. Pure functions: no DOM. */

export const round1 = (value) => Math.round(value * 10) / 10;

export const linear = (d0, d1, r0, r1) => (value) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) * (r1 - r0)) / (d1 - d0));

/* A "nice" number near `range`: 1, 2, 5 or 10 times a power of ten. */
function nice(range, rounded) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction;
  if (rounded) niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

/* Round tick values covering [min, max], about `target` of them. Always includes the nice bounds. */
export function niceTicks(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0], min: 0, max: 0 };
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return niceTicks(min - pad, max + pad, target);
  }
  const range = nice(max - min, false);
  const step = nice(range / Math.max(1, target - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return { ticks, min: niceMin, max: niceMax };
}

export function pathLine(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${round1(point.x)} ${round1(point.y)}`).join("");
}

export function pathArea(points, baseline) {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points.at(-1);
  return `M${round1(first.x)} ${round1(baseline)}${points.map((point) => `L${round1(point.x)} ${round1(point.y)}`).join("")}L${round1(last.x)} ${round1(baseline)}Z`;
}

/* A smooth-ish step path: used for cumulative curves that move at discrete days. */
export function pathStep(points) {
  if (points.length === 0) return "";
  let d = `M${round1(points[0].x)} ${round1(points[0].y)}`;
  for (let index = 1; index < points.length; index += 1) {
    d += `L${round1(points[index].x)} ${round1(points[index - 1].y)}L${round1(points[index].x)} ${round1(points[index].y)}`;
  }
  return d;
}

/* The heat level 0..4 of a value against the largest magnitude in the set. 0 is "nothing". */
export function heatLevel(value, maxAbs) {
  if (!value || !maxAbs) return 0;
  const ratio = Math.abs(value) / maxAbs;
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
}

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function maxAbs(values) {
  return values.reduce((best, value) => (Number.isFinite(value) ? Math.max(best, Math.abs(value)) : best), 0);
}
