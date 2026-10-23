/* Checking frozen days: that what is on disk is what was sealed, and that it is consistent.
 *
 * `checkDay` takes one day's files and re-derives everything that can be re-derived from them:
 * hashes against the manifest, each summary from its trades, the desk from the summaries, the
 * standings from the summaries and the rules, the hour buckets from their own totals, the
 * window from the zone. `verifyRoot` adds what only the whole folder can show: that days form
 * an unbroken chain, and nothing half-written or unlisted is lying around. Findings carry the
 * day and the file, because "something is wrong" is not something a person can act on. */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fromCents, sha256, toCents } from "./canonical.mjs";
import { SCHEMAS } from "./project.mjs";
import { scanFiles, describe } from "./privacy.mjs";
import { stats } from "./metrics.mjs";
import { evaluatePeriod } from "./score.mjs";
import { dayWindow, windowRecord } from "./time.mjs";

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

export function listFiles(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(relative(directory, full).split(sep).join("/"));
    }
  };
  walk(directory);
  return found.sort();
}

/* Every file of a day folder as a Map of relative path -> text. */
export function readDayFiles(directory) {
  return new Map(listFiles(directory).map((path) => [path, readFileSync(join(directory, path), "utf8")]));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function closesFromTrades(trades) {
  return trades.trades.map((trade) => ({
    key: String(trade.i), ticket: trade.i, symbol: trade.symbol, side: trade.side,
    cents: toCents(trade.net), r: trade.r, closeSec: trade.i, openSec: null,
  }));
}

const extremeOf = (close) => (close ? { symbol: close.symbol ?? "UNKNOWN", net: fromCents(close.cents), r: Number.isFinite(close.r) ? close.r : null } : null);

/* Findings for one day. `files` is a Map of relative path -> text and includes day.json.
 * `rules` is the parsed rules file the day was sealed under (or null if it cannot be found). */
export function checkDay({ date, files, rules }) {
  const findings = [];
  const add = (severity, file, message) => findings.push({ severity, day: date, file, message });

  const manifestText = files.get("day.json");
  if (manifestText === undefined) {
    add("error", "day.json", "the manifest is missing");
    return findings;
  }
  let manifest;
  try {
    manifest = SCHEMAS.day(JSON.parse(manifestText), "$");
  } catch (error) {
    add("error", "day.json", `the manifest is not valid: ${error.message}`);
    return findings;
  }
  if (manifest.date !== date) add("error", "day.json", `the manifest says ${manifest.date} but the folder is ${date}`);

  /* 1. the files are exactly the files that were sealed */
  const actual = new Set([...files.keys()].filter((path) => path !== "day.json"));
  for (const path of Object.keys(manifest.files)) {
    if (!actual.has(path)) { add("error", path, "listed in the manifest but missing"); continue; }
    const text = files.get(path);
    const entry = manifest.files[path];
    if (sha256(text) !== entry.sha256) add("error", path, "content does not match its recorded SHA-256");
    else if (Buffer.byteLength(text, "utf8") !== entry.bytes) add("error", path, "size does not match the manifest");
  }
  for (const path of actual) if (!(path in manifest.files)) add("error", path, "present but not listed in the manifest");

  /* 2. the window is the zone's window (a tzdata update can change history: warn, not fail) */
  try {
    const expected = windowRecord(dayWindow(date, manifest.zone));
    if (!same(expected, manifest.window)) add("warn", "day.json", "the recorded window differs from the one this machine computes for that zone");
  } catch (error) {
    add("error", "day.json", `the window cannot be recomputed: ${error.message}`);
  }

  /* 3. every account folder re-derives from its own trades */
  const summaries = new Map();
  const keys = [...new Set([...actual].filter((path) => path.startsWith("accounts/")).map((path) => path.split("/")[1]))].sort();
  for (const key of keys) {
    const read = (name) => {
      const text = files.get(`accounts/${key}/${name}`);
      if (text === undefined) { add("error", `accounts/${key}/${name}`, "is missing"); return null; }
      try { return JSON.parse(text); } catch { add("error", `accounts/${key}/${name}`, "is not valid JSON"); return null; }
    };
    const summaryRaw = read("summary.json");
    const tradesRaw = read("trades.json");
    const hoursRaw = read("hours.json");
    if (!summaryRaw || !tradesRaw || !hoursRaw) continue;
    let summary; let trades; let hours;
    try {
      summary = SCHEMAS.summary(summaryRaw, "$");
      trades = SCHEMAS.trades(tradesRaw, "$");
      hours = SCHEMAS.hours(hoursRaw, "$");
    } catch (error) {
      add("error", `accounts/${key}`, `a file does not match its schema: ${error.message}`);
      continue;
    }
    summaries.set(key, summary);
    if (manifest.accounts[key] !== summary.status) add("error", `accounts/${key}/summary.json`, `status ${summary.status} differs from the manifest (${manifest.accounts[key]})`);
    if (summary.date !== date || trades.date !== date || hours.date !== date) add("error", `accounts/${key}`, "a file carries a different date");

    const st = stats(closesFromTrades(trades));
    const redone = {
      n: st.n, wins: st.wins, losses: st.losses, breakevens: st.breakevens, winRatePct: st.winRatePct,
      grossWin: fromCents(st.grossWinCents), grossLoss: fromCents(st.grossLossCents), net: fromCents(st.netCents),
      profitFactor: st.profitFactor, maxDrawdown: fromCents(st.maxDrawdownCents), streaks: st.streaks, r: st.r,
      best: extremeOf(st.best), worst: extremeOf(st.worst),
      pairs: st.pairs.map((pair) => ({ symbol: pair.symbol, n: pair.n, net: fromCents(pair.netCents) })),
    };
    for (const [field, value] of Object.entries(redone)) {
      if (!same(value, summary[field])) add("error", `accounts/${key}/summary.json`, `${field} does not match the trades (${JSON.stringify(summary[field])} vs ${JSON.stringify(value)})`);
    }
    const bucketSum = hours.buckets.reduce((total, bucket) => total + bucket.n, 0) + hours.earlier + hours.unknown;
    if (bucketSum !== hours.total || hours.total !== summary.n) add("error", `accounts/${key}/hours.json`, `buckets add up to ${bucketSum}, total ${hours.total}, closes ${summary.n}`);
    if (hours.buckets.length !== Math.ceil(manifest.window.hours)) add("error", `accounts/${key}/hours.json`, `${hours.buckets.length} buckets for a ${manifest.window.hours} hour day`);
  }
  for (const [key, status] of Object.entries(manifest.accounts)) {
    if (status !== "prefunding" && !keys.includes(key)) add("error", `accounts/${key}`, "listed in the manifest but has no folder");
  }

  /* 4. the desk and the standings re-derive from the summaries */
  const deskText = files.get("desk.json");
  if (deskText !== undefined) {
    try {
      const desk = SCHEMAS.desk(JSON.parse(deskText), "$");
      const list = [...summaries.values()];
      const sum = (pick) => list.reduce((total, summary) => total + pick(summary), 0);
      const redone = { n: sum((s) => s.n), wins: sum((s) => s.wins), losses: sum((s) => s.losses), net: fromCents(sum((s) => toCents(s.net))) };
      for (const [field, value] of Object.entries(redone)) if (desk[field] !== value) add("error", "desk.json", `${field} is ${desk[field]} but the accounts add up to ${value}`);
      if (desk.status !== manifest.status) add("error", "desk.json", `status ${desk.status} differs from the manifest (${manifest.status})`);
      if (desk.hours.total !== redone.n) add("error", "desk.json", `hour total ${desk.hours.total} differs from ${redone.n} closes`);
    } catch (error) {
      add("error", "desk.json", `not valid: ${error.message}`);
    }
  } else add("error", "desk.json", "is missing");

  const starsText = files.get("stars.json");
  if (starsText !== undefined) {
    try {
      const doc = SCHEMAS.stars(JSON.parse(starsText), "$");
      if (doc.rules !== manifest.rules) add("error", "stars.json", `sealed under ${doc.rules} but the manifest says ${manifest.rules}`);
      if (!rules) {
        add("error", "stars.json", `the rules file for ${manifest.rules} was not found, so the standings cannot be re-derived`);
      } else {
        const rows = [...summaries.values()].filter((summary) => manifest.accounts[summary.key] !== "prefunding").map((summary) => {
          const closes = [];
          const trades = JSON.parse(files.get(`accounts/${summary.key}/trades.json`));
          closes.push(...closesFromTrades(trades));
          // Accounts not yet funded are "prefunding" and never reach this list, so for a single
          // day nobody can be disqualified as having joined later: funded-on-or-before is `date`.
          return {
            key: summary.key, label: summary.label, fundedDate: date, fundingCents: summary.funding === null ? null : toCents(summary.funding),
            stats: stats(closes), activeDays: summary.n > 0 ? 1 : 0, statuses: [summary.status],
          };
        });
        const again = evaluatePeriod({ kind: "day", periodStart: date, rows }, rules);
        const expectedRows = again.rows.map((row) => ({ key: row.key, rank: row.rank, score: row.score, qualified: row.qualified, n: row.n }));
        const foundRows = doc.rows.map((row) => ({ key: row.key, rank: row.rank, score: row.score, qualified: row.qualified, n: row.n }));
        if (!same(expectedRows, foundRows)) add("error", "stars.json", "the standings do not match what the summaries and the rules give");
        if ((again.crown?.key ?? null) !== (doc.crown?.key ?? null)) add("error", "stars.json", "the crown does not match what the summaries and the rules give");
      }
    } catch (error) {
      add("error", "stars.json", `not valid: ${error.message}`);
    }
  } else add("error", "stars.json", "is missing");

  /* 5. nothing in the day may carry what must never be published */
  for (const finding of scanFiles(files)) add("error", finding.file, `privacy: ${describe(finding)}`);
  return findings;
}

export function listFrozen(root) {
  const base = join(root, "results");
  const found = [];
  if (!existsSync(base)) return found;
  for (const year of readdirSync(base)) {
    if (!/^\d{4}$/.test(year)) continue;
    for (const month of readdirSync(join(base, year))) {
      if (!/^\d{2}$/.test(month)) continue;
      for (const date of readdirSync(join(base, year, month))) {
        const dir = join(base, year, month, date);
        if (!DATE_DIR.test(date) || !statSync(dir).isDirectory()) continue;
        const file = join(dir, "day.json");
        if (!existsSync(file)) { found.push({ date, dir, text: null, manifest: null, seq: null }); continue; }
        const text = readFileSync(file, "utf8");
        let manifest = null;
        try { manifest = JSON.parse(text); } catch { /* reported by verifyRoot */ }
        found.push({ date, dir, text, manifest, seq: Number.isInteger(manifest?.seq) ? manifest.seq : null });
      }
    }
  }
  return found.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || (a.date < b.date ? -1 : 1));
}

/* Every check over the whole results folder. `rulesFor(version)` returns the parsed rules or null. */
export function verifyRoot(root, { rulesFor = () => null } = {}) {
  const findings = [];
  const add = (severity, day, file, message) => findings.push({ severity, day, file, message });
  const base = join(root, "results");
  if (!existsSync(base)) return { findings, days: 0 };

  for (const entry of readdirSync(base)) {
    if (entry.startsWith(".sealing-")) add("error", null, `results/${entry}`, "a half-written day was left behind");
    else if (!/^\d{4}$/.test(entry) && !["index.json", "series.json"].includes(entry)) add("error", null, `results/${entry}`, "is not a place frozen data may live");
  }

  const days = listFrozen(root);
  const seen = new Set();
  days.forEach((day, index) => {
    if (day.text === null) { add("error", day.date, "day.json", "the day folder has no manifest"); return; }
    if (seen.has(day.date)) add("error", day.date, "day.json", "the date is frozen twice");
    seen.add(day.date);
    if (day.seq !== index + 1) add("error", day.date, "day.json", `sequence number ${day.seq} where ${index + 1} was expected: a day was deleted, added or renumbered`);
    const previous = days[index - 1];
    const prev = day.manifest?.prev ?? null;
    if (index === 0) {
      if (prev !== null) add("error", day.date, "day.json", "the first day must not point at a previous day");
    } else if (!prev) {
      add("error", day.date, "day.json", "the chain link to the previous day is missing");
    } else if (previous.text !== null) {
      if (prev.sha256 !== sha256(previous.text) || prev.date !== previous.date || prev.seq !== previous.seq)
        add("error", day.date, "day.json", `the chain link does not match the previous day (${previous.date}): that day's manifest was changed`);
    }
    const files = readDayFiles(day.dir);
    const rules = rulesFor(day.manifest?.rules);
    findings.push(...checkDay({ date: day.date, files, rules }));
  });
  return { findings, days: days.length };
}

export const errorsOf = (findings) => findings.filter((finding) => finding.severity === "error");
export const formatFinding = (finding) => `${finding.severity.toUpperCase()} ${finding.day ?? "-"} ${finding.file}: ${finding.message}`;
