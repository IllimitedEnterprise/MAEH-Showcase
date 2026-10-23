/* Everything that is derived from the frozen days: stars/ and results/index.json, series.json.
 *
 * None of it is ever edited. `buildDerived` is a pure function of the frozen days, so the same
 * days always give the same bytes; `checkDerived` proves that by rebuilding and comparing with
 * what is on disk, and CI runs it, so a hand edit to a standings file cannot survive. */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fromCents, sha256, stringify, toCents } from "./canonical.mjs";
import { asOf, buildTally, crownOf, everything, leaderOf, provisionalPeriod } from "./crowns.mjs";
import { stats } from "./metrics.mjs";
import { project } from "./project.mjs";
import { addDays } from "./time.mjs";
import { listFrozen, readDayFiles } from "./verify.mjs";

/* The frozen days, loaded into the model the crown logic works on. */
export function loadModel(root, { seasonStart, zone, allow, rulesFor }) {
  const days = [];
  for (const frozen of listFrozen(root)) {
    if (frozen.text === null || !frozen.manifest) continue;
    const files = readDayFiles(frozen.dir);
    const accounts = {};
    for (const [key, status] of Object.entries(frozen.manifest.accounts)) {
      if (status === "prefunding") {
        accounts[key] = { status, summary: null, trades: [], hours: null };
        continue;
      }
      accounts[key] = {
        status,
        summary: JSON.parse(files.get(`accounts/${key}/summary.json`)),
        trades: JSON.parse(files.get(`accounts/${key}/trades.json`)).trades,
        hours: JSON.parse(files.get(`accounts/${key}/hours.json`)),
      };
    }
    days.push({
      date: frozen.date, seq: frozen.manifest.seq, kind: frozen.manifest.kind, status: frozen.manifest.status,
      rules: frozen.manifest.rules, sha256: sha256(frozen.text), accounts,
      stars: JSON.parse(files.get("stars.json")), desk: JSON.parse(files.get("desk.json")),
    });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rulesByVersion = {};
  for (const version of new Set(["v1", ...days.map((day) => day.rules)])) {
    const rules = rulesFor(version);
    if (rules) rulesByVersion[version] = rules;
  }
  return { seasonStart, zone, allow, rulesByVersion, days };
}

const standingOf = (row) => ({
  key: row.key, label: row.label, rank: row.rank, score: row.score, n: row.n, net: fromCents(row.netCents),
  retPct: row.retPct, qualified: row.qualified, why: row.why, comp: row.comp,
});
const miniOf = (row) => ({ key: row.key, rank: row.rank, score: row.score, n: row.n, net: row.net });
const miniFromEvaluated = (row) => ({ key: row.key, rank: row.rank, score: row.score, n: row.n, net: fromCents(row.netCents) });

const periodBlockOf = (period) => period && ({
  kind: period.kind, period: period.period, start: period.start, end: period.end, through: period.through,
  complete: period.complete, provisional: period.provisional,
  rows: period.evaluated.rows.map(standingOf), leader: period.leader, crown: period.crown,
});

const signed = (value) => (value > 0 ? `+${value.toFixed(2)}` : value < 0 ? value.toFixed(2) : "0.00");
const cell = (value) => (value === null || value === undefined ? "-" : String(value));

function leaderboardMarkdown(doc) {
  const lines = ["# Star leaderboard", "", doc.asOf ? `As of ${doc.asOf}. Rules ${doc.rules}: see [RULES.md](RULES.md).` : "No frozen days yet.", ""];
  const table = (rows) => [
    "| Rank | Account | Score | Closes | Net | Return |", "|---:|---|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${cell(row.rank)} | [${row.label}](accounts/${row.key}.md) | ${cell(row.score)} | ${row.n} | ${signed(row.net)} | ${row.retPct === null ? "-" : `${row.retPct}%`} |`),
    "",
  ];
  if (doc.day) {
    lines.push(`## Day ${doc.day.date}`, "", doc.day.crown ? `Star of the day: **${doc.day.crown.label}** (score ${doc.day.crown.score}).` : "No Star of the day.", "", ...table(doc.day.rows));
  }
  for (const [name, block] of [["Week", doc.week], ["Month", doc.month]]) {
    if (!block) continue;
    const state = block.complete ? "complete" : `leading, through ${block.through}`;
    lines.push(`## ${name} ${block.period} (${state})`, "",
      block.crown ? `Star of the ${name.toLowerCase()}: **${block.crown.label}** (score ${block.crown.score}).`
        : block.leader ? `Leading: **${block.leader.label}** (score ${block.leader.score}). Not a crown until the period closes.` : "No qualified account yet.", "", ...table(block.rows));
  }
  lines.push("## All-time crowns", "", "| Account | Day | Week | Month | Points | Day streak | Best streak |", "|---|---:|---:|---:|---:|---:|---:|",
    ...doc.tally.map((row) => `| [${row.label}](accounts/${row.key}.md) | ${row.day} | ${row.week} | ${row.month} | ${row.points} | ${row.streak.cur} | ${row.streak.best} |`), "");
  return lines.join("\n");
}

function rulesMarkdown(rules) {
  const period = (kind) => rules.periods[kind];
  return `${[
    "# Star rules",
    "",
    `Rules version **${rules.version}**. Days are sealed under the rules in force on the day, so changing these never rewrites a past crown.`,
    "",
    "Every account here is a demo account. A score describes what happened over a period under these rules; it is not advice and not a measure of quality or safety.",
    "",
    "## The score",
    "",
    "Four marks, each between 0 and 1, are blended into a raw figure out of 100, then pulled toward 50 by a credibility factor so that a few lucky trades cannot outrank a long solid record.",
    "",
    "| Mark | What it measures | Full mark | No mark |",
    "|---|---|---|---|",
    `| Return (${rules.weights.ret * 100}%) | net result as a share of funding; zero earns half a mark | +retHalf % | -retHalf % |`,
    `| Profit factor (${rules.weights.pf * 100}%) | gross win over gross loss, on a log scale; 1 earns half | 4 (or no losses) | 0.25 or below |`,
    `| Drawdown (${rules.weights.dd * 100}%) | the deepest fall of the running result, as a share of funding | none | ddZero % |`,
    `| Win rate (${rules.weights.win * 100}%) | wins over wins plus losses, breakevens excluded | ${rules.winRate.floor + rules.winRate.span}% | ${rules.winRate.floor}% |`,
    "",
    "`score = 50 + (raw - 50) x n / (n + k)`, where n is the number of closes and k depends on the period.",
    "",
    "## Periods",
    "",
    "| Period | retHalf % | ddZero % | k | Closes needed | Active days needed |",
    "|---|---:|---:|---:|---:|---:|",
    ...["day", "week", "month"].map((kind) => `| ${kind} | ${period(kind).retHalf} | ${period(kind).ddZero} | ${period(kind).k} | ${period(kind).minCloses} | ${period(kind).minActiveDays} |`),
    "",
    "A week is the ISO week, Monday to Sunday, in the season's time zone. A month is the calendar month.",
    "",
    "## Who can be ranked",
    "",
    "An account is ranked for a period only if it was funded by the first day of the period, has a funding record, has enough closes and active days, and every day of the period was complete and verified. Anyone else still appears in the table, with the reason.",
    "",
    "## The crown",
    "",
    `The crown goes to rank 1${rules.crownNeedsPositiveNet ? ", and only if that account's net result is positive; otherwise there is no Star" : ""}. Ties are broken by net result, then profit factor, then lower drawdown, then more closes, then the account key.`,
    "",
    "Week and month crowns are awarded only when every day of the period is frozen. Until then the page shows who is leading, which is not a crown. A period that began before the season did is marked as partial.",
    "",
    "## Points",
    "",
    `A day crown is worth ${rules.pointsPerCrown.day}, a week crown ${rules.pointsPerCrown.week}, a month crown ${rules.pointsPerCrown.month}. A streak is consecutive crowned days won by the same account; a day with no crown does not break it, a different winner does.`,
    "",
  ].join("\n")}`;
}

function accountReport({ model, allow, all }) {
  const latest = model.days.at(-1) ?? null;
  const closes = [];
  const pairs = new Map();
  const hours = new Map();
  let earlier = 0;
  let unknown = 0;
  let total = 0;
  let fundingCents = null;
  let activeDays = 0;
  let days = 0;
  const dayNets = [];
  const form = [];
  model.days.forEach((day, dayIndex) => {
    const account = day.accounts[allow.key];
    const row = day.stars.rows.find((entry) => entry.key === allow.key) ?? null;
    if (!account || account.status === "prefunding") {
      form.push({ date: day.date, status: "prefunding", n: 0, net: null, score: null, rank: null, crowned: false });
      return;
    }
    days += 1;
    if (account.summary.funding !== null) fundingCents = toCents(account.summary.funding);
    if (account.trades.length) activeDays += 1;
    if (account.trades.length) dayNets.push({ date: day.date, net: account.summary.net });
    for (const trade of account.trades) {
      closes.push({ key: `${day.date}#${trade.i}`, ticket: null, symbol: trade.symbol, cents: toCents(trade.net), r: trade.r, closeSec: dayIndex * 100_000 + trade.i });
    }
    for (const pair of account.summary.pairs) {
      const entry = pairs.get(pair.symbol) ?? { symbol: pair.symbol, n: 0, cents: 0 };
      entry.n += pair.n;
      entry.cents += toCents(pair.net);
      pairs.set(pair.symbol, entry);
    }
    for (const bucket of account.hours.buckets) hours.set(bucket.h, (hours.get(bucket.h) ?? 0) + bucket.n);
    earlier += account.hours.earlier;
    unknown += account.hours.unknown;
    total += account.hours.total;
    form.push({
      date: day.date, status: account.status, n: account.summary.n, net: account.summary.net,
      score: row?.score ?? null, rank: row?.rank ?? null, crowned: day.stars.crown?.key === allow.key,
    });
  });
  const st = stats(closes);
  const funded = fundingCents !== null && fundingCents > 0;
  const mine = all.awards.filter((award) => award.key === allow.key);
  const tally = all.tally.find((row) => row.key === allow.key);
  const best = [...dayNets].sort((a, b) => b.net - a.net || (a.date < b.date ? -1 : 1))[0] ?? null;
  const worst = [...dayNets].sort((a, b) => a.net - b.net || (a.date < b.date ? -1 : 1))[0] ?? null;
  return project("account", {
    schema: 1, key: allow.key, label: allow.label, fundedDate: allow.fundedDate, asOf: latest?.date ?? null, rules: latest?.rules ?? "v1",
    totals: {
      days, activeDays, n: st.n, wins: st.wins, losses: st.losses, breakevens: st.breakevens, winRatePct: st.winRatePct,
      net: fromCents(st.netCents), grossWin: fromCents(st.grossWinCents), grossLoss: fromCents(st.grossLossCents),
      profitFactor: st.profitFactor, retPct: funded ? Number(((100 * st.netCents) / fundingCents).toFixed(3)) : null,
      maxDrawdown: fromCents(st.maxDrawdownCents), ddPct: funded ? Number(((100 * st.maxDrawdownCents) / fundingCents).toFixed(3)) : null,
      streaks: st.streaks,
    },
    bestDay: best, worstDay: worst,
    crowns: {
      day: tally?.day ?? 0, week: tally?.week ?? 0, month: tally?.month ?? 0, points: tally?.points ?? 0,
      streak: tally?.streak ?? { cur: 0, best: 0, bestFrom: null, bestTo: null },
      awards: mine.map((award) => ({ kind: award.kind, period: award.period })),
    },
    form,
    pairs: [...pairs.values()].sort((a, b) => b.n - a.n || (a.symbol < b.symbol ? -1 : 1)).map((pair) => ({ symbol: pair.symbol, n: pair.n, net: fromCents(pair.cents) })),
    hours: {
      basis: "entry-of-closes",
      buckets: [...hours.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([h, n]) => ({ h, n })),
      earlier, unknown, total,
    },
  });
}

function accountMarkdown(report) {
  const t = report.totals;
  const lines = [
    `# ${report.label}`, "",
    report.asOf ? `Account report as of ${report.asOf}. Rules ${report.rules}. Demo account; not advice.` : "No frozen days yet.", "",
    "| | |", "|---|---|",
    `| Days on the desk | ${t.days} (${t.activeDays} with closes) |`,
    `| Closes | ${t.n} (${t.wins} won, ${t.losses} lost, ${t.breakevens} even) |`,
    `| Net | ${signed(t.net)} |`,
    `| Win rate | ${t.winRatePct === null ? "-" : `${t.winRatePct}%`} |`,
    `| Profit factor | ${t.profitFactor ?? (t.grossWin > 0 ? "no losses" : "-")} |`,
    `| Return on funding | ${t.retPct === null ? "-" : `${t.retPct}%`} |`,
    `| Max drawdown | ${t.maxDrawdown.toFixed(2)}${t.ddPct === null ? "" : ` (${t.ddPct}%)`} |`,
    `| Longest runs | ${t.streaks.maxWins} wins, ${t.streaks.maxLosses} losses |`,
    `| Best day | ${report.bestDay ? `${report.bestDay.date} (${signed(report.bestDay.net)})` : "-"} |`,
    `| Worst day | ${report.worstDay ? `${report.worstDay.date} (${signed(report.worstDay.net)})` : "-"} |`,
    "", "## Crowns", "",
    `Day crowns ${report.crowns.day}, week crowns ${report.crowns.week}, month crowns ${report.crowns.month}: ${report.crowns.points} points. Current day-crown streak ${report.crowns.streak.cur}; best ${report.crowns.streak.best}${report.crowns.streak.bestFrom ? ` (${report.crowns.streak.bestFrom} to ${report.crowns.streak.bestTo})` : ""}.`,
    "", "## Recent form", "", "| Date | Status | Closes | Net | Score | Rank | Crown |", "|---|---|---:|---:|---:|---:|---|",
    ...report.form.slice(-14).reverse().map((day) => `| ${day.date} | ${day.status} | ${day.n} | ${day.net === null ? "-" : signed(day.net)} | ${cell(day.score)} | ${cell(day.rank)} | ${day.crowned ? "Star" : ""} |`),
    "", "## Pairs", "", report.pairs.length ? report.pairs.map((pair) => `${pair.symbol} x${pair.n} (${signed(pair.net)})`).join(", ") : "None yet.", "",
    "## When it enters", "", `Trades per local entry hour, over every frozen day (${report.hours.total} closes; ${report.hours.earlier} opened on an earlier day, ${report.hours.unknown} with no entry record).`, "",
    report.hours.buckets.filter((bucket) => bucket.n > 0).map((bucket) => `${bucket.h} x${bucket.n}`).join(", ") || "None yet.", "",
  ];
  return lines.join("\n");
}

const keyCompare = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/* Every derived file, as a Map of repository-relative path -> text. */
export function buildDerived(model) {
  const all = everything(model);
  const rules = all.rules;
  const latest = model.days.at(-1) ?? null;
  const files = new Map();

  const leaderboard = project("leaderboard", {
    schema: 1, rules: rules.version, asOf: latest?.date ?? null,
    day: latest ? { date: latest.date, rows: latest.stars.rows, crown: latest.stars.crown } : null,
    week: periodBlockOf(all.currentWeek), month: periodBlockOf(all.currentMonth), tally: all.tally,
  });
  files.set("stars/leaderboard.json", stringify(leaderboard));
  files.set("stars/leaderboard.md", `${leaderboardMarkdown(leaderboard)}`);
  files.set("stars/RULES.md", rulesMarkdown(rules));

  const periods = [...all.weekOutcomes, ...all.monthOutcomes].sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0) || (a.kind < b.kind ? -1 : 1))
    .map((outcome) => ({ kind: outcome.kind, period: outcome.period, start: outcome.start, end: outcome.end, partialPeriod: outcome.partialPeriod, basis: outcome.basis, crown: crownOf(outcome.evaluated) }));
  files.set("stars/crowns.json", stringify(project("crowns", { schema: 1, rules: rules.version, awards: all.awards, periods, tally: all.tally })));

  for (const day of model.days) {
    const sub = asOf(model, day.date);
    const week = provisionalPeriod(sub, "week");
    const month = provisionalPeriod(sub, "month");
    const dayRules = model.rulesByVersion[day.rules] ?? rules;
    const tally = buildTally(sub, all.awards.filter((award) => award.end <= day.date), dayRules);
    const block = (period) => period && {
      period: period.period, through: period.through, complete: period.complete,
      rows: period.evaluated.rows.map(miniFromEvaluated), leader: period.leader, crown: period.crown,
    };
    const doc = project("history", {
      schema: 1, date: day.date, rules: day.rules,
      day: { rows: day.stars.rows.map(miniOf), crown: day.stars.crown },
      week: block(week), month: block(month),
      tally: tally.map((row) => ({ key: row.key, points: row.points, day: row.day, week: row.week, month: row.month })),
    });
    files.set(`stars/history/${day.date}.json`, stringify(doc));
  }

  for (const allow of model.allow) {
    const report = accountReport({ model, allow, all });
    files.set(`stars/accounts/${allow.key}.json`, stringify(report));
    files.set(`stars/accounts/${allow.key}.md`, accountMarkdown(report));
  }

  /* the catalogue and the cumulative series */
  const present = new Set(model.days.map((day) => day.date));
  const gaps = [];
  if (latest) for (let date = model.seasonStart; date < latest.date; date = addDays(date, 1)) if (!present.has(date)) gaps.push(date);
  const tip = model.days.reduce((best, day) => (!best || day.seq > best.seq ? day : best), null);
  files.set("results/index.json", stringify(project("index", {
    schema: 1, zone: model.zone, seasonStart: model.seasonStart,
    tip: tip ? { seq: tip.seq, date: tip.date, sha256: tip.sha256 } : null,
    days: model.days.map((day) => ({ date: day.date, seq: day.seq, kind: day.kind, status: day.status, sha256: day.sha256, n: day.desk.n, net: day.desk.net, crown: day.stars.crown?.key ?? null })),
    gaps,
    accounts: model.allow.map((allow) => ({ key: allow.key, label: allow.label, fundedDate: allow.fundedDate })),
  })));

  const running = Object.fromEntries(model.allow.map((allow) => [allow.key, 0]));
  let deskCents = 0;
  const series = model.days.map((day) => {
    deskCents += toCents(day.desk.net);
    const accounts = {};
    for (const allow of model.allow) {
      const account = day.accounts[allow.key];
      if (!account || account.status === "prefunding") {
        accounts[allow.key] = { status: "prefunding", n: 0, net: null, cum: null };
        continue;
      }
      running[allow.key] += toCents(account.summary.net);
      accounts[allow.key] = { status: account.status, n: account.summary.n, net: account.summary.net, cum: fromCents(running[allow.key]) };
    }
    return { date: day.date, desk: { n: day.desk.n, net: day.desk.net, cum: fromCents(deskCents) }, accounts };
  });
  files.set("results/series.json", stringify(project("series", { schema: 1, seasonStart: model.seasonStart, days: series })));

  return new Map([...files.entries()].sort(keyCompare));
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, text, "utf8");
  renameSync(temp, path);
}

function listUnder(root, folder) {
  const base = join(root, folder);
  if (!existsSync(base)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(base);
  return found;
}

/* Write the derived files, replacing what is there, and remove stars/ files no longer produced. */
export function writeDerived(root, files) {
  const removed = [];
  for (const [path, text] of files) writeAtomic(join(root, path), text);
  for (const path of listUnder(root, "stars")) {
    if (!files.has(path)) { rmSync(join(root, path), { force: true }); removed.push(path); }
  }
  return { written: files.size, removed };
}

/* Findings where the disk does not match a fresh rebuild. */
export function checkDerived(root, files) {
  const findings = [];
  for (const [path, text] of files) {
    const file = join(root, path);
    if (!existsSync(file)) findings.push({ severity: "error", day: null, file: path, message: "derived file is missing; run rank" });
    else if (readFileSync(file, "utf8") !== text) findings.push({ severity: "error", day: null, file: path, message: "derived file differs from a rebuild; it was edited or is out of date" });
  }
  for (const path of listUnder(root, "stars")) {
    if (!files.has(path)) findings.push({ severity: "error", day: null, file: path, message: "derived file that a rebuild would not produce" });
  }
  return findings;
}
