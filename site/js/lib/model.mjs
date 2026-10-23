/* Questions the pages ask of the loaded catalogue, answered once, here. Pure functions over the
 * `core` object that loadCore() returns, so they run the same in a test as in the browser. */

import { dayNumber, dateOfDayNumber } from "../charts/geometry.mjs";

export const ENTITY_SLOTS = 8;

export const accountKeys = (core) => core.index.accounts.map((account) => account.key);
export const labelOf = (core, key) => core.index.accounts.find((account) => account.key === key)?.label ?? key;

/* Colour follows the account, never its rank: the slot is its position in the configured list. */
export function entitySlot(core, key) {
  const position = accountKeys(core).indexOf(key);
  return position >= 0 && position < ENTITY_SLOTS ? position + 1 : 0;
}
export const entityClass = (core, key) => `ent-${entitySlot(core, key) || "x"}`;

export const frozenDays = (core) => core.index.days;
export const dayEntry = (core, date) => core.index.days.find((day) => day.date === date) ?? null;
export const latestDate = (core) => core.index.days.at(-1)?.date ?? null;
export const firstDate = (core) => core.index.days[0]?.date ?? null;

export function neighbours(core, date) {
  const dates = core.index.days.map((day) => day.date);
  const position = dates.indexOf(date);
  return { prev: position > 0 ? dates[position - 1] : null, next: position >= 0 && position < dates.length - 1 ? dates[position + 1] : null };
}

/* [{ date, value: cumulative net, net, n }] for the whole desk, oldest first. */
export function deskSeries(core) {
  return core.series.days.map((day) => ({ date: day.date, value: day.desk.cum, net: day.desk.net, n: day.desk.n }));
}

/* Cumulative net of one account; days before it was funded are left out, not drawn as zero. */
export function accountSeries(core, key) {
  const out = [];
  for (const day of core.series.days) {
    const entry = day.accounts[key];
    if (entry && entry.cum !== null && entry.cum !== undefined) out.push({ date: day.date, value: entry.cum, net: entry.net, n: entry.n, status: entry.status });
  }
  return out;
}

/* Daily net per calendar day, for bars: a frozen day with no closes is kept (as n = 0). */
export function dailyBars(core, key = null) {
  return core.series.days
    .map((day) => {
      const entry = key ? day.accounts[key] : day.desk;
      if (!entry || entry.net === null || entry.net === undefined) return null;
      return { date: day.date, value: entry.net, n: entry.n };
    })
    .filter(Boolean);
}

/* The last `count` calendar days that exist in a series, or all of them. */
export function lastDays(rows, count) {
  if (!count || rows.length <= count) return rows;
  const last = dayNumber(rows.at(-1).date);
  return rows.filter((row) => dayNumber(row.date) > last - count);
}

export function seasonTotals(core) {
  const days = core.index.days;
  const active = days.filter((day) => day.n > 0);
  const best = active.reduce((top, day) => (top === null || day.net > top.net ? day : top), null);
  /* With a single day of trades the best day is also the worst; there is nothing to compare it with. */
  const worst = active.length < 2 ? null : active.reduce((low, day) => (low === null || day.net < low.net ? day : low), null);
  return {
    frozen: days.length,
    active: active.length,
    closes: days.reduce((sum, day) => sum + day.n, 0),
    net: Math.round(days.reduce((sum, day) => sum + day.net, 0) * 100) / 100,
    best: best ? { date: best.date, net: best.net } : null,
    worst: worst ? { date: worst.date, net: worst.net } : null,
    start: days[0]?.date ?? null,
    end: days.at(-1)?.date ?? null,
  };
}

export function monthsAvailable(core) {
  const set = new Set(core.index.days.map((day) => day.date.slice(0, 7)));
  return [...set].sort();
}

export function shiftMonth(month, delta) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* Dates in the catalogue that are missing between its first and last day (a visible gap). */
export function missingDates(core) {
  const have = new Set(core.index.days.map((day) => day.date));
  if (have.size === 0) return [];
  const numbers = core.index.days.map((day) => dayNumber(day.date));
  const out = [];
  for (let number = Math.min(...numbers); number <= Math.max(...numbers); number += 1) {
    const date = dateOfDayNumber(number);
    if (!have.has(date)) out.push(date);
  }
  return out;
}

/* ISO 8601 week of a calendar date, as "2026-W43" (the rule the Star weeks use). */
export function isoWeek(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 3);
  const year = day.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((day - jan4) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function crownFor(core, kind, period) {
  return core.crowns.awards.find((award) => award.kind === kind && award.period === period) ?? null;
}

export const tallyRow = (core, key) => core.crowns.tally.find((row) => row.key === key) ?? null;

/* Why a period has no Star, in a sentence a visitor can follow. */
export function crownNote(rows) {
  const ranked = rows.filter((row) => row.rank !== null).sort((a, b) => a.rank - b.rank);
  if (ranked.length === 0) return "No account was ranked: none had enough closes.";
  if (ranked[0].net <= 0) return "No Star: the top-ranked account did not finish in profit.";
  return "No Star was awarded.";
}

/* The standings the Stars page shows for a tab. */
export function standings(core, tab) {
  const board = core.leaderboard;
  if (tab === "week") return board.week;
  if (tab === "month") return board.month;
  return board.day;
}
