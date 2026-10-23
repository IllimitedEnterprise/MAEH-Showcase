/* From captured closes to the public files of one day.
 *
 * Nothing here touches the disk or the clock: closes in, a map of relative path -> text out.
 * Every JSON object goes through `project` (the allowlist) before it is written, so a field
 * that is not named in the schema stops the day instead of reaching a published file. All
 * text is printable ASCII and LF, so the same day always renders to the same bytes.
 *
 * day.json, the manifest, is not made here: it lists the hash of every file below, and the
 * chain link to the previous day, so the seal step writes it last. */

import { fromCents, stringify } from "./canonical.mjs";
import { withResult } from "./ingest.mjs";
import { hoursRecord, stats } from "./metrics.mjs";
import { project } from "./project.mjs";
import { evaluatePeriod } from "./score.mjs";
import { count } from "./words.mjs";

const money = fromCents;
const round = (value, places) => Number(value.toFixed(places));
const signed = (value) => (value > 0 ? `+${value.toFixed(2)}` : value < 0 ? value.toFixed(2) : "0.00");
const percent = (value) => (value === null ? "n/a" : `${value}%`);
const profitFactorText = (st) => (st.profitFactor !== null ? String(st.profitFactor) : st.grossWinCents > 0 ? "no losses" : "n/a");

/* Problem codes -> the one plain sentence a reader sees. Notes that only describe plumbing
 * (which file a number came from) are not shown; they are in `source`. */
const REASONS = {
  "api-unavailable": (p) => `the live read was unavailable (${p.detail ?? "error"})`,
  "terminal-forgot": (p) => `${p.n} close(s) are in the harness ledger but no longer in the terminal's own history`,
  "ledger-torn": () => "the last line of the close ledger was incomplete and was ignored",
  "ledger-unreadable": () => "the close ledger could not be read",
  "ledger-stale": () => "the close ledger was older than the end of the day, so it could not prove it was current",
  "null-result": (p) => `${p.n} close(s) have no recorded result and are not counted`,
  "balance-gap": (p) => `the balance moved by ${signed(money(p.amountCents))} more than the closes explain`,
  unverified: (p) => `history before the ledger began may be incomplete: funding plus all closes differ from the balance by ${signed(money(p.amountCents))}`,
  "api-truncated": () => "the live read was cut at its 500-close limit and no ledger was available",
  "no-complete-source": () => "no complete source was available for this day",
};

export function describeProblem(problem) {
  const make = REASONS[problem.code];
  return make ? make(problem) : null;
}

function publicReasons(problems, kind) {
  const lines = [];
  for (const problem of problems) {
    if (problem.code === "api-unavailable" && kind === "backfilled") continue;
    const line = describeProblem(problem);
    if (line) lines.push(line);
  }
  return lines;
}

const extreme = (close) => (close ? { symbol: close.symbol ?? "UNKNOWN", net: money(close.cents), r: Number.isFinite(close.r) ? close.r : null } : null);

/* One account's day: its status, statistics and every public file of its folder. */
export function buildAccountDay({ allow, capture, gate = null, date, window, kind }) {
  if (date < allow.fundedDate) return { key: allow.key, label: allow.label, status: "prefunding" };

  const usable = Boolean(capture?.usable);
  const closes = usable ? withResult(capture.closes) : [];
  const st = stats(closes);
  const problems = capture ? [...capture.problems] : [{ code: "no-complete-source", severity: "blocking" }];
  if (gate && gate.ok === false) problems.push({ code: "unverified", severity: "unverified", amountCents: gate.gapCents });

  const flagged = !usable || problems.some((problem) => problem.severity === "partial" || problem.severity === "blocking");
  const status = flagged ? "partial"
    : problems.some((problem) => problem.severity === "unverified") ? "unverified"
      : st.n > 0 ? "ok" : "quiet";

  const fundingCents = Number.isInteger(capture?.fundingCents) ? capture.fundingCents : null;
  const funded = fundingCents !== null && fundingCents > 0;
  const chain = gate && gate.ok !== null ? gate : (capture?.delta ?? { ok: null, gapCents: null });

  const summary = project("summary", {
    schema: 1, date, key: allow.key, label: allow.label, status,
    reasons: publicReasons(problems, kind),
    source: usable ? (capture.source ?? "ledger") : "none",
    currency: capture?.currency ?? null,
    funding: funded ? money(fundingCents) : null,
    n: st.n, wins: st.wins, losses: st.losses, breakevens: st.breakevens, winRatePct: st.winRatePct,
    grossWin: money(st.grossWinCents), grossLoss: money(st.grossLossCents), net: money(st.netCents),
    profitFactor: st.profitFactor,
    retPct: funded ? round((100 * st.netCents) / fundingCents, 3) : null,
    maxDrawdown: money(st.maxDrawdownCents),
    ddPct: funded ? round((100 * st.maxDrawdownCents) / fundingCents, 3) : null,
    streaks: st.streaks, r: st.r, best: extreme(st.best), worst: extreme(st.worst),
    pairs: st.pairs.map((pair) => ({ symbol: pair.symbol, n: pair.n, net: money(pair.netCents) })),
    chain: { ok: chain.ok ?? null, gap: Number.isInteger(chain.gapCents) ? money(chain.gapCents) : null },
  });

  const ordered = [...closes].sort((a, b) => a.closeSec - b.closeSec || (a.ticket ?? 0) - (b.ticket ?? 0));
  const rows = ordered.map((close, index) => ({ i: index + 1, symbol: close.symbol, side: close.side, net: money(close.cents), r: Number.isFinite(close.r) ? close.r : null }));
  const trades = project("trades", { schema: 1, date, key: allow.key, trades: rows });
  const hours = project("hours", { schema: 1, date, key: allow.key, ...hoursRecord(closes, window) });

  const folder = `accounts/${allow.key}`;
  const files = new Map([
    [`${folder}/summary.json`, stringify(summary)],
    [`${folder}/summary.md`, summaryMarkdown(summary)],
    [`${folder}/trades.json`, stringify(trades)],
    [`${folder}/trades.csv`, tradesCsv(rows)],
    [`${folder}/hours.json`, stringify(hours)],
  ]);
  return { key: allow.key, label: allow.label, fundedDate: allow.fundedDate, status, st, summary, hours, files, fundingCents, activeDays: st.n > 0 ? 1 : 0 };
}

function tradesCsv(rows) {
  const cell = (value) => (value === null || value === undefined ? "" : String(value));
  return `${["i,symbol,side,net,r", ...rows.map((row) => [row.i, row.symbol, row.side, row.net.toFixed(2), row.r].map(cell).join(","))].join("\n")}\n`;
}

function summaryMarkdown(summary) {
  const lines = [`# ${summary.label} - ${summary.date}`, "", `Status: **${summary.status}** (source: ${summary.source})`];
  if (summary.reasons.length) lines.push("", ...summary.reasons.map((reason) => `- ${reason}`));
  if (summary.source === "none") return `${lines.join("\n")}\n`;
  lines.push("", "| | |", "|---|---|",
    `| Net | ${signed(summary.net)}${summary.currency ? ` ${summary.currency}` : ""} |`,
    `| Closes | ${summary.n} (${summary.wins} won, ${summary.losses} lost, ${summary.breakevens} even) |`,
    `| Win rate | ${percent(summary.winRatePct)} |`,
    `| Profit factor | ${summary.profitFactor !== null ? summary.profitFactor : summary.grossWin > 0 ? "no losses" : "n/a"} |`,
    `| Return on funding | ${summary.retPct === null ? "n/a" : `${summary.retPct > 0 ? "+" : ""}${summary.retPct}%`} |`,
    `| Max drawdown | ${summary.maxDrawdown.toFixed(2)}${summary.ddPct === null ? "" : ` (${summary.ddPct}% of funding)`} |`,
    `| Longest runs | ${count(summary.streaks.maxWins, "win")}, ${count(summary.streaks.maxLosses, "loss", "losses")} |`);
  if (summary.r) lines.push(`| R | ${summary.r.sum > 0 ? "+" : ""}${summary.r.sum} over ${count(summary.r.count, "close")} |`);
  if (summary.best) lines.push("", `Best close: ${summary.best.symbol} ${signed(summary.best.net)}. Worst close: ${summary.worst ? `${summary.worst.symbol} ${signed(summary.worst.net)}` : "none"}.`);
  if (summary.pairs.length) lines.push("", `Pairs: ${summary.pairs.map((pair) => `${pair.symbol} x${pair.n} (${signed(pair.net)})`).join(", ")}.`);
  return `${lines.join("\n")}\n`;
}

function deskOf({ date, days }) {
  const present = days.filter((day) => day.status !== "prefunding");
  const sum = (pick) => present.reduce((total, day) => total + pick(day.st), 0);
  const wins = sum((st) => st.wins);
  const losses = sum((st) => st.losses);
  const grossWin = sum((st) => st.grossWinCents);
  const grossLoss = sum((st) => st.grossLossCents);
  const trading = present.filter((day) => day.st.n > 0);
  const byNet = [...trading].sort((a, b) => b.st.netCents - a.st.netCents || (a.key < b.key ? -1 : 1));
  const count = (status) => days.filter((day) => day.status === status).length;
  const status = count("partial") + count("unverified") > 0 ? "partial" : "complete";

  const first = present[0]?.hours;
  const hours = {
    basis: "entry-of-closes", zone: first?.zone ?? "", earlier: 0, unknown: 0, total: 0,
    buckets: (first?.buckets ?? []).map((bucket) => ({ h: bucket.h, off: bucket.off, n: 0 })),
  };
  for (const day of present) {
    day.hours.buckets.forEach((bucket, index) => { hours.buckets[index].n += bucket.n; });
    hours.earlier += day.hours.earlier;
    hours.unknown += day.hours.unknown;
    hours.total += day.hours.total;
  }

  return project("desk", {
    schema: 1, date, status,
    accounts: { ok: count("ok"), quiet: count("quiet"), partial: count("partial"), unverified: count("unverified"), prefunding: count("prefunding") },
    n: sum((st) => st.n), wins, losses,
    winRatePct: wins + losses ? round((wins / (wins + losses)) * 100, 1) : null,
    net: money(sum((st) => st.netCents)), grossWin: money(grossWin), grossLoss: money(grossLoss),
    profitFactor: grossLoss > 0 ? round(money(grossWin) / money(grossLoss), 2) : null,
    best: byNet[0] ? { key: byNet[0].key, net: money(byNet[0].st.netCents) } : null,
    worst: byNet.length > 1 ? { key: byNet.at(-1).key, net: money(byNet.at(-1).st.netCents) } : null,
    perAccount: present.map((day) => ({ key: day.key, label: day.label, status: day.status, n: day.st.n, net: money(day.st.netCents) })),
    hours,
  });
}

function starsOf({ date, days, rules }) {
  const rows = days.filter((day) => day.status !== "prefunding").map((day) => ({
    key: day.key, label: day.label, fundedDate: day.fundedDate, fundingCents: day.fundingCents,
    stats: day.st, activeDays: day.activeDays, statuses: [day.status],
  }));
  const evaluated = evaluatePeriod({ kind: "day", periodStart: date, rows }, rules);
  return {
    evaluated,
    doc: project("stars", {
      schema: 1, date, rules: rules.version,
      rows: evaluated.rows.map((row) => ({
        key: row.key, label: row.label, rank: row.rank, score: row.score, n: row.n, net: money(row.netCents),
        retPct: row.retPct, qualified: row.qualified, why: row.why, comp: row.comp,
      })),
      crown: evaluated.crown ? { key: evaluated.crown.key, label: evaluated.crown.label, score: evaluated.crown.score, net: money(evaluated.crown.netCents) } : null,
      withheld: evaluated.withheld,
    }),
  };
}

function readme({ date, kind, desk, starsDoc, days }) {
  const lines = [`# ${date}`, ""];
  const clean = desk.accounts.ok + desk.accounts.quiet;
  const total = days.length - desk.accounts.prefunding;
  lines.push(`Status: **${desk.status}** - ${clean} of ${total} accounts read cleanly. Frozen as ${kind}.`, "");
  lines.push(`Desk net **${signed(desk.net)}** over ${count(desk.n, "close")}. Win rate ${percent(desk.winRatePct)}. Profit factor ${desk.profitFactor ?? (desk.grossWin > 0 ? "no losses" : "n/a")}.`, "");
  lines.push(starsDoc.crown
    ? `Star of the day: **${starsDoc.crown.label}** (score ${starsDoc.crown.score}, net ${signed(starsDoc.crown.net)}).`
    : "No Star of the day: no qualified account finished with a positive net result.", "");
  const byKey = new Map(starsDoc.rows.map((row) => [row.key, row]));
  lines.push("| Rank | Account | Status | Closes | Net | Score |", "|---:|---|---|---:|---:|---:|");
  for (const day of days) {
    if (day.status === "prefunding") {
      lines.push(`| - | ${day.label} | not funded yet | - | - | - |`);
      continue;
    }
    const row = byKey.get(day.key);
    lines.push(`| ${row.rank ?? "-"} | ${day.label} | ${day.status} | ${day.st.n} | ${signed(money(day.st.netCents))} | ${row.score ?? "-"} |`);
  }
  lines.push("", "Files: `day.json` (manifest and hashes), `desk.json`, `stars.json`, and `accounts/<key>/` (`summary`, `trades`, `hours`).", "");
  return lines.join("\n");
}

/* Everything except day.json. `accounts` is one entry per published account:
 *   { allow: {key, label, fundedDate}, capture: <captureAccount result> | null, gate: {ok, gapCents} | null } */
export function renderDay({ date, window, kind, accounts, rules }) {
  const days = accounts.map(({ allow, capture, gate }) => buildAccountDay({ allow, capture, gate, date, window, kind }));
  const desk = deskOf({ date, days });
  const { doc: starsDoc, evaluated } = starsOf({ date, days, rules });

  const files = new Map();
  for (const day of days) for (const [path, text] of day.files ?? []) files.set(path, text);
  files.set("desk.json", stringify(desk));
  files.set("stars.json", stringify(starsDoc));
  files.set("README.md", readme({ date, kind, desk, starsDoc, days }));

  return {
    files: new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    accountStatuses: Object.fromEntries(days.map((day) => [day.key, day.status])),
    status: desk.status,
    desk, stars: starsDoc, evaluated, days,
  };
}
