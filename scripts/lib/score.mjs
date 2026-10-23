/* The Star score: one number for how an account did over a period, and who wears the crown.
 *
 * The score is built so that a good result earns trust slowly. Four marks between 0 and 1 are
 * blended into a raw 0-100 figure, then pulled toward 50 by a credibility factor n / (n + k):
 * with few closes the score stays near the middle, so three lucky trades cannot outrank sixty
 * solid ones. The constants live in config/rules.v1.json and are versioned: a day keeps the
 * rules it was sealed under, so changing them never rewrites history.
 *
 *   m_ret  return on funding, centred: 0 % earns half a mark, +retHalf % earns a full one
 *   m_pf   profit factor on a log scale: 1 earns half, 4 earns a full mark, 0.25 earns none
 *   m_dd   drawdown as a share of funding: none earns a full mark, ddZero % earns none
 *   m_win  win rate, breakevens excluded: 30 % earns none, 70 % earns a full mark
 *
 * Demo accounts, performance measurement only: a score describes what happened over a period,
 * never a recommendation to follow an account. */

const clamp = (value) => Math.min(1, Math.max(0, value));
const round = (value, places) => Number(value.toFixed(places));
const log4 = (value) => Math.log(value) / Math.log(4);

/* The score of one account over one period, or nulls when there is nothing to score. */
export function scorePeriod({ stats, fundingCents, params, rules }) {
  const n = stats.n;
  if (!n || !(fundingCents > 0)) return { score: null, comp: null, retPct: null, ddPct: null };
  const retPct = (100 * stats.netCents) / fundingCents;
  const ddPct = (100 * stats.maxDrawdownCents) / fundingCents;
  const pf = stats.profitFactor;
  const ret = clamp(0.5 + (0.5 * retPct) / params.retHalf);
  const dd = 1 - clamp(ddPct / params.ddZero);
  const profit = pf === null ? (stats.grossWinCents > 0 ? 1 : 0.5) : pf <= 0 ? 0 : clamp(0.5 + log4(pf) / 2);
  const win = stats.decided === 0 ? 0.5 : clamp((stats.winRatePct - rules.winRate.floor) / rules.winRate.span);
  const w = rules.weights;
  const raw = 100 * (w.ret * ret + w.pf * profit + w.dd * dd + w.win * win);
  const cred = n / (n + params.k);
  return {
    score: round(50 + (raw - 50) * cred, 2),
    comp: { ret: round(ret, 3), pf: round(profit, 3), dd: round(dd, 3), win: round(win, 3), cred: round(cred, 3) },
    retPct: round(retPct, 3),
    ddPct: round(ddPct, 3),
  };
}

const WHY = {
  "few-closes": (info) => `needs ${info.need} closes, has ${info.have}`,
  "not-ok": () => "the period is not complete and verified",
  "joined-later": () => "joined after the period began",
  "no-funding": () => "no funding record to score against",
  "few-days": (info) => `needs ${info.need} active days, has ${info.have}`,
};
const why = (code, info = {}) => WHY[code](info);

/* Why an account cannot be ranked for the period. Empty means it can. */
export function disqualifications({ row, params, periodStart }) {
  const reasons = [];
  if (row.fundedDate > periodStart) reasons.push(why("joined-later"));
  if (!(row.fundingCents > 0)) reasons.push(why("no-funding"));
  if (row.stats.n < params.minCloses) reasons.push(why("few-closes", { need: params.minCloses, have: row.stats.n }));
  if (row.activeDays < params.minActiveDays) reasons.push(why("few-days", { need: params.minActiveDays, have: row.activeDays }));
  if (row.statuses.some((status) => status !== "ok" && status !== "quiet")) reasons.push(why("not-ok"));
  return reasons;
}

/* Higher score first; then net result, profit factor (no losses is the best), lower drawdown,
 * more closes, and finally the key, so the order is total and never depends on input order. */
export function compareRanked(a, b) {
  const score = Math.round((b.score ?? -Infinity) * 100) - Math.round((a.score ?? -Infinity) * 100);
  if (score) return score;
  if (b.netCents !== a.netCents) return b.netCents - a.netCents;
  const pa = a.profitFactor === null ? Infinity : a.profitFactor;
  const pb = b.profitFactor === null ? Infinity : b.profitFactor;
  if (pb !== pa) return pb > pa ? 1 : -1;
  if (a.ddPct !== b.ddPct) return (a.ddPct ?? Infinity) - (b.ddPct ?? Infinity);
  if (b.n !== a.n) return b.n - a.n;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/* Evaluate one period for a set of accounts. Each input row:
 *   { key, label, fundedDate, fundingCents, stats, activeDays, statuses }
 * Returns every row with its score, whether it qualified and why not, the ranking among the
 * qualified, and the crown: rank 1, but only with a positive net result. */
export function evaluatePeriod({ kind, periodStart, rows }, rules) {
  const params = rules.periods[kind];
  const evaluated = rows.map((row) => {
    const scored = scorePeriod({ stats: row.stats, fundingCents: row.fundingCents, params, rules });
    const reasons = disqualifications({ row, params, periodStart });
    return {
      key: row.key, label: row.label, n: row.stats.n, netCents: row.stats.netCents,
      profitFactor: row.stats.profitFactor, qualified: reasons.length === 0, why: reasons, ...scored,
    };
  });
  const ranked = evaluated.filter((row) => row.qualified).sort(compareRanked);
  ranked.forEach((row, index) => { row.rank = index + 1; });
  for (const row of evaluated) if (!row.qualified) row.rank = null;

  const leader = ranked[0] ?? null;
  const crown = leader && (!rules.crownNeedsPositiveNet || leader.netCents > 0) ? leader : null;
  const withheld = evaluated
    .filter((row) => !row.qualified && row.n >= params.minCloses && row.why.includes(why("not-ok")))
    .map((row) => ({ key: row.key, reason: "partial or unverified, so not eligible" }));

  const order = new Map(ranked.map((row, index) => [row.key, index]));
  evaluated.sort((a, b) => {
    const ia = order.has(a.key) ? order.get(a.key) : Infinity;
    const ib = order.has(b.key) ? order.get(b.key) : Infinity;
    if (ia !== ib) return ia - ib;
    return b.n - a.n || (a.key < b.key ? -1 : 1);
  });
  return { kind, rows: evaluated, crown, withheld };
}
