/* Crowns beyond the day: weeks, months, the all-time tally and streaks.
 *
 * Everything here is a pure function of the frozen days (the "model"), never of the clock, so
 * it can be rebuilt at any time and always comes out the same. The day crown is sealed inside
 * each day's own stars.json; week and month crowns are derived from the days of the period.
 *
 * A model is:
 *   { seasonStart, allow: [{ key, label, fundedDate }], rulesByVersion: { v1: rules },
 *     days: [{ date, kind, rules, accounts: { key: { status, summary|null, trades: [...] } }, stars }] }
 * with days sorted by date. A period is crowned only once EVERY day of it (from the season
 * start on) is frozen; until then it is shown as "leading", never as a crown. */

import { fromCents, toCents } from "./canonical.mjs";
import { stats } from "./metrics.mjs";
import { evaluatePeriod } from "./score.mjs";
import { isoWeekKey, monthDates, monthKey, weekDates } from "./time.mjs";

const PERIOD_ID = { week: (date) => isoWeekKey(date), month: (date) => monthKey(date) };
const PERIOD_DATES = { week: (date) => weekDates(date), month: (date) => monthDates(date) };

const basisOf = (days) => {
  const kinds = new Set(days.map((day) => day.kind));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
};

/* The dates of a calendar period that the season actually covers. */
export function effectiveDates(kind, anyDate, seasonStart) {
  return PERIOD_DATES[kind](anyDate).filter((date) => date >= seasonStart);
}

/* Score every published account over the frozen days of one period. `periodStart` is the first
 * day of the period that the season covers; an account funded after it cannot be ranked. */
export function evaluateDays({ kind, days, periodStart, model }) {
  const last = days.at(-1);
  const rules = model.rulesByVersion[last?.rules ?? "v1"] ?? Object.values(model.rulesByVersion)[0];
  const rows = model.allow.map((allow) => {
    const closes = [];
    const statuses = [];
    let activeDays = 0;
    let fundingCents = null;
    days.forEach((day, dayIndex) => {
      const account = day.accounts[allow.key];
      statuses.push(account?.status ?? "prefunding");
      if (!account?.summary) return;
      if (account.summary.funding !== null) fundingCents = toCents(account.summary.funding);
      if (account.trades.length > 0) activeDays += 1;
      for (const trade of account.trades) {
        closes.push({ key: `${day.date}#${trade.i}`, ticket: null, symbol: trade.symbol, side: trade.side, cents: toCents(trade.net), r: trade.r, closeSec: dayIndex * 100_000 + trade.i, openSec: null });
      }
    });
    return {
      key: allow.key, label: allow.label, fundedDate: allow.fundedDate, fundingCents, stats: stats(closes), activeDays,
      statuses: statuses.filter((status) => status !== "prefunding"),
    };
  });
  return evaluatePeriod({ kind, periodStart, rows }, rules);
}

export const leaderOf = (evaluated) => {
  const top = evaluated.rows.find((row) => row.rank === 1) ?? null;
  return top ? { key: top.key, label: top.label, score: top.score, net: fromCents(top.netCents) } : null;
};

export const crownOf = (evaluated) => (evaluated.crown
  ? { key: evaluated.crown.key, label: evaluated.crown.label, score: evaluated.crown.score, net: fromCents(evaluated.crown.netCents) }
  : null);

/* Every complete week or month, crowned (or not) in date order. */
export function periodAwards(model, kind) {
  const byDate = new Map(model.days.map((day) => [day.date, day]));
  const periods = new Map();
  for (const day of model.days) {
    const id = PERIOD_ID[kind](day.date);
    if (!periods.has(id)) periods.set(id, day.date);
  }
  const awards = [];
  const outcomes = [];
  for (const [id, anyDate] of periods) {
    const expected = effectiveDates(kind, anyDate, model.seasonStart);
    if (!expected.every((date) => byDate.has(date))) continue; // not complete yet (or has a gap)
    const days = expected.map((date) => byDate.get(date));
    const start = expected[0];
    const end = expected.at(-1);
    const evaluated = evaluateDays({ kind, days, periodStart: start, model });
    const calendar = PERIOD_DATES[kind](anyDate);
    outcomes.push({ kind, period: id, start, end, evaluated, partialPeriod: calendar[0] < model.seasonStart, basis: basisOf(days) });
    const crown = crownOf(evaluated);
    if (crown) {
      const row = evaluated.rows.find((entry) => entry.key === crown.key);
      awards.push({ kind, period: id, start, end, key: crown.key, label: crown.label, score: crown.score, net: crown.net, n: row.n, partialPeriod: calendar[0] < model.seasonStart, basis: basisOf(days) });
    }
  }
  return { awards, outcomes };
}

/* Day crowns as sealed in each day's stars.json. */
export function dayAwards(model) {
  const awards = [];
  for (const day of model.days) {
    const crown = day.stars?.crown;
    if (!crown) continue;
    const row = day.stars.rows.find((entry) => entry.key === crown.key);
    awards.push({ kind: "day", period: day.date, start: day.date, end: day.date, key: crown.key, label: crown.label, score: crown.score, net: crown.net, n: row?.n ?? 0, partialPeriod: false, basis: day.kind });
  }
  return awards;
}

/* The unfinished week or month that contains the latest frozen day, if it is unfinished. */
export function provisionalPeriod(model, kind) {
  const latest = model.days.at(-1);
  if (!latest) return null;
  const id = PERIOD_ID[kind](latest.date);
  const expected = effectiveDates(kind, latest.date, model.seasonStart);
  const byDate = new Map(model.days.map((day) => [day.date, day]));
  const have = expected.filter((date) => byDate.has(date));
  if (have.length === 0) return null;
  const complete = expected.every((date) => byDate.has(date));
  const days = have.map((date) => byDate.get(date));
  const evaluated = evaluateDays({ kind, days, periodStart: expected[0], model });
  return {
    kind, period: id, start: expected[0], end: expected.at(-1), through: have.at(-1), complete, provisional: !complete,
    evaluated, leader: leaderOf(evaluated), crown: complete ? crownOf(evaluated) : null,
  };
}

const AWARD_ORDER = { day: 0, week: 1, month: 2 };

export function sortAwards(awards) {
  return [...awards].sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0) || AWARD_ORDER[a.kind] - AWARD_ORDER[b.kind]);
}

/* Day-crown streaks: consecutive crowned days won by the same account. A day nobody was crowned
 * on is transparent; a different winner breaks the run. */
export function dayStreaks(model, key) {
  let current = 0;
  let best = 0;
  let bestFrom = null;
  let bestTo = null;
  let runFrom = null;
  let holder = null;
  for (const day of model.days) {
    const winner = day.stars?.crown?.key ?? null;
    if (winner === null) continue;
    if (winner === key) {
      if (holder === key) current += 1;
      else { current = 1; runFrom = day.date; }
      if (current > best) { best = current; bestFrom = runFrom; bestTo = day.date; }
    } else {
      current = 0;
    }
    holder = winner;
  }
  return { cur: holder === key ? current : 0, best, bestFrom, bestTo };
}

/* Crowns per account and the points they are worth. */
export function buildTally(model, awards, rules) {
  const points = rules.pointsPerCrown;
  return model.allow.map((allow) => {
    const mine = awards.filter((award) => award.key === allow.key);
    const count = (kind) => mine.filter((award) => award.kind === kind).length;
    const day = count("day");
    const week = count("week");
    const month = count("month");
    return {
      key: allow.key, label: allow.label, day, week, month,
      points: day * points.day + week * points.week + month * points.month,
      streak: dayStreaks(model, allow.key),
    };
  }).sort((a, b) => b.points - a.points || b.month - a.month || b.week - a.week || b.day - a.day || (a.key < b.key ? -1 : 1));
}

/* The model as it stood at the end of `date`: what the dashboard shows when it replays history. */
export const asOf = (model, date) => ({ ...model, days: model.days.filter((day) => day.date <= date) });

export function everything(model) {
  const rules = model.rulesByVersion[model.days.at(-1)?.rules ?? "v1"] ?? Object.values(model.rulesByVersion)[0];
  const week = periodAwards(model, "week");
  const month = periodAwards(model, "month");
  const awards = sortAwards([...dayAwards(model), ...week.awards, ...month.awards]);
  return {
    rules, awards, tally: buildTally(model, awards, rules),
    weekOutcomes: week.outcomes, monthOutcomes: month.outcomes,
    currentWeek: provisionalPeriod(model, "week"), currentMonth: provisionalPeriod(model, "month"),
  };
}
