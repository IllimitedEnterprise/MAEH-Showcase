/* The public allowlist.
 *
 * Every object that is written to results/ or stars/ is first passed through `project`. A
 * schema here names every key a public object may have; a key that is not named makes the
 * projection THROW rather than being dropped, so a field added upstream can never reach a
 * published file by accident. Text is limited to printable ASCII, so no stray byte, control
 * character or invisible codepoint can ride along either. Output follows the schema's key
 * order, which is the order a person reads a file in. */

export class ProjectionError extends Error {}

const fail = (path, message) => { throw new ProjectionError(`${path}: ${message}`); };

const PRINTABLE = /^[\x20-\x7E]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._-]{1,48}$/;
const SYMBOL = /^[A-Za-z0-9._#-]{1,32}$/;
const HOUR = /^\d{2}:\d{2}$/;

const text = (max) => (value, path) => {
  if (typeof value !== "string") fail(path, `expected text, got ${typeof value}`);
  if (value.length > max) fail(path, `text longer than ${max}`);
  if (!PRINTABLE.test(value)) fail(path, "text must be printable ASCII");
  return value;
};

const pattern = (regex, what) => (value, path) => {
  if (typeof value !== "string" || !regex.test(value)) fail(path, `expected ${what}`);
  return value;
};

export const t = {
  int: (value, path) => {
    if (!Number.isInteger(value)) fail(path, `expected an integer, got ${JSON.stringify(value)}`);
    return value;
  },
  num: (value, path) => {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, `expected a finite number, got ${JSON.stringify(value)}`);
    return Object.is(value, -0) ? 0 : value;
  },
  /* A money amount: at most two decimals. */
  money: (value, path) => {
    const number = t.num(value, path);
    if (Math.abs(number * 100 - Math.round(number * 100)) > 1e-6) fail(path, `money with more than two decimals: ${number}`);
    return number;
  },
  /* A mark between 0 and 1. */
  unit: (value, path) => {
    const number = t.num(value, path);
    if (number < 0 || number > 1) fail(path, `expected 0..1, got ${number}`);
    return number;
  },
  bool: (value, path) => {
    if (typeof value !== "boolean") fail(path, "expected true or false");
    return value;
  },
  str: text(120),
  line: text(240),
  date: pattern(DATE, "a YYYY-MM-DD date"),
  isoUtc: pattern(ISO_UTC, "an ISO UTC timestamp"),
  offset: pattern(OFFSET, "a +HH:MM offset"),
  hex64: pattern(HEX64, "a 64-character lowercase hex digest"),
  key: pattern(KEY, "a folder-safe key"),
  symbol: pattern(SYMBOL, "an instrument symbol"),
  hour: pattern(HOUR, "an HH:MM hour label"),
  enum: (...allowed) => (value, path) => {
    if (!allowed.includes(value)) fail(path, `expected one of ${allowed.join("|")}, got ${JSON.stringify(value)}`);
    return value;
  },
  nullable: (spec) => (value, path) => (value === null ? null : spec(value, path)),
  array: (spec) => (value, path) => {
    if (!Array.isArray(value)) fail(path, "expected a list");
    return value.map((item, index) => spec(item, `${path}[${index}]`));
  },
  /* A fixed set of named keys. Unknown keys throw; a missing key throws unless `optional`. */
  object: (shape) => (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
    for (const key of Object.keys(value)) {
      if (!(key in shape)) fail(`${path}.${key}`, "field is not on the public allowlist");
    }
    const out = {};
    for (const [key, spec] of Object.entries(shape)) {
      if (value[key] === undefined) {
        if (spec.optional) continue;
        fail(`${path}.${key}`, "missing");
      }
      out[key] = (spec.optional ? spec.inner : spec)(value[key], `${path}.${key}`);
    }
    return out;
  },
  /* An object whose keys are data (account keys, file paths); both sides are checked. */
  map: (keySpec, valueSpec) => (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      keySpec(key, `${path}{key ${key}}`);
      out[key] = valueSpec(inner, `${path}.${key}`);
    }
    return out;
  },
  optional: (inner) => Object.assign((value, path) => inner(value, path), { optional: true, inner }),
};

const FILE_PATH = pattern(/^[A-Za-z0-9._\-/]{1,160}$/, "a relative file path");
const reasons = t.array(t.line);
const side = t.enum("long", "short", "unknown");
const pair = t.object({ symbol: t.symbol, n: t.int, net: t.money });
const extreme = t.nullable(t.object({ symbol: t.symbol, net: t.money, r: t.nullable(t.num) }));

const comp = t.object({ ret: t.unit, pf: t.unit, dd: t.unit, win: t.unit, cred: t.unit });
const standing = t.object({
  key: t.key, label: t.str, rank: t.nullable(t.int), score: t.nullable(t.num), n: t.int, net: t.money,
  retPct: t.nullable(t.num), qualified: t.bool, why: t.array(t.line), comp: t.nullable(comp),
});
const miniRow = t.object({ key: t.key, rank: t.nullable(t.int), score: t.nullable(t.num), n: t.int, net: t.money });
const crownRef = t.nullable(t.object({ key: t.key, label: t.str, score: t.num, net: t.money }));
const basis = t.enum("nightly", "catchup", "backfilled", "mixed");
const streak = t.object({ cur: t.int, best: t.int, bestFrom: t.nullable(t.date), bestTo: t.nullable(t.date) });
const tallyRow = t.object({ key: t.key, label: t.str, day: t.int, week: t.int, month: t.int, points: t.int, streak });
const award = t.object({
  kind: t.enum("day", "week", "month"), period: t.str, start: t.date, end: t.date, key: t.key, label: t.str,
  score: t.num, net: t.money, n: t.int, partialPeriod: t.bool, basis,
});
const periodBlock = t.object({
  kind: t.enum("week", "month"), period: t.str, start: t.date, end: t.date, through: t.date, complete: t.bool,
  provisional: t.bool, rows: t.array(standing), leader: crownRef, crown: crownRef,
});

export const hoursShape = {
  basis: t.enum("entry-of-closes"),
  zone: t.str,
  buckets: t.array(t.object({ h: t.hour, off: t.offset, n: t.int })),
  earlier: t.int,
  unknown: t.int,
  total: t.int,
};

export const SCHEMAS = {
  day: t.object({
    schema: t.enum(1),
    seq: t.int,
    date: t.date,
    zone: t.str,
    window: t.object({ startUtc: t.isoUtc, endUtc: t.isoUtc, startOff: t.offset, endOff: t.offset, hours: t.num }),
    kind: t.enum("nightly", "catchup", "backfilled"),
    status: t.enum("complete", "partial"),
    capturedAt: t.isoUtc,
    rules: t.str,
    accounts: t.map(t.key, t.enum("ok", "quiet", "partial", "unverified", "prefunding")),
    files: t.map(FILE_PATH, t.object({ sha256: t.hex64, bytes: t.int })),
    prev: t.nullable(t.object({ seq: t.int, date: t.date, sha256: t.hex64 })),
  }),
  summary: t.object({
    schema: t.enum(1),
    date: t.date,
    key: t.key,
    label: t.str,
    status: t.enum("ok", "quiet", "partial", "unverified"),
    reasons,
    source: t.enum("api", "ledger", "both", "none"),
    currency: t.nullable(t.str),
    funding: t.nullable(t.money),
    n: t.int,
    wins: t.int,
    losses: t.int,
    breakevens: t.int,
    winRatePct: t.nullable(t.num),
    grossWin: t.money,
    grossLoss: t.money,
    net: t.money,
    profitFactor: t.nullable(t.num),
    retPct: t.nullable(t.num),
    maxDrawdown: t.money,
    ddPct: t.nullable(t.num),
    streaks: t.object({ maxWins: t.int, maxLosses: t.int }),
    r: t.nullable(t.object({ count: t.int, sum: t.num })),
    best: extreme,
    worst: extreme,
    pairs: t.array(pair),
    chain: t.object({ ok: t.nullable(t.bool), gap: t.nullable(t.money) }),
  }),
  trades: t.object({
    schema: t.enum(1),
    date: t.date,
    key: t.key,
    trades: t.array(t.object({ i: t.int, symbol: t.nullable(t.symbol), side, net: t.money, r: t.nullable(t.num) })),
  }),
  hours: t.object({ schema: t.enum(1), date: t.date, key: t.key, ...hoursShape }),
  desk: t.object({
    schema: t.enum(1),
    date: t.date,
    status: t.enum("complete", "partial"),
    accounts: t.object({ ok: t.int, quiet: t.int, partial: t.int, unverified: t.int, prefunding: t.int }),
    n: t.int,
    wins: t.int,
    losses: t.int,
    winRatePct: t.nullable(t.num),
    net: t.money,
    grossWin: t.money,
    grossLoss: t.money,
    profitFactor: t.nullable(t.num),
    best: t.nullable(t.object({ key: t.key, net: t.money })),
    worst: t.nullable(t.object({ key: t.key, net: t.money })),
    perAccount: t.array(t.object({ key: t.key, label: t.str, status: t.enum("ok", "quiet", "partial", "unverified"), n: t.int, net: t.money })),
    hours: t.object(hoursShape),
  }),
  /* One day's standings: the rows of the leaderboard and the crown, if one was earned. */
  stars: t.object({
    schema: t.enum(1),
    date: t.date,
    rules: t.str,
    rows: t.array(standing),
    crown: crownRef,
    withheld: t.array(t.object({ key: t.key, reason: t.line })),
  }),

  /* --- derived: everything below is rebuilt from the frozen days, never edited --- */
  leaderboard: t.object({
    schema: t.enum(1),
    rules: t.str,
    asOf: t.nullable(t.date),
    day: t.nullable(t.object({ date: t.date, rows: t.array(standing), crown: crownRef })),
    week: t.nullable(periodBlock),
    month: t.nullable(periodBlock),
    tally: t.array(tallyRow),
  }),
  crowns: t.object({
    schema: t.enum(1),
    rules: t.str,
    awards: t.array(award),
    periods: t.array(t.object({
      kind: t.enum("week", "month"), period: t.str, start: t.date, end: t.date, partialPeriod: t.bool, basis,
      crown: crownRef,
    })),
    tally: t.array(tallyRow),
  }),
  history: t.object({
    schema: t.enum(1),
    date: t.date,
    rules: t.str,
    day: t.object({ rows: t.array(miniRow), crown: crownRef }),
    week: t.nullable(t.object({ period: t.str, through: t.date, complete: t.bool, rows: t.array(miniRow), leader: crownRef, crown: crownRef })),
    month: t.nullable(t.object({ period: t.str, through: t.date, complete: t.bool, rows: t.array(miniRow), leader: crownRef, crown: crownRef })),
    tally: t.array(t.object({ key: t.key, points: t.int, day: t.int, week: t.int, month: t.int })),
  }),
  account: t.object({
    schema: t.enum(1),
    key: t.key,
    label: t.str,
    fundedDate: t.date,
    asOf: t.nullable(t.date),
    rules: t.str,
    totals: t.object({
      days: t.int, activeDays: t.int, n: t.int, wins: t.int, losses: t.int, breakevens: t.int, winRatePct: t.nullable(t.num),
      net: t.money, grossWin: t.money, grossLoss: t.money, profitFactor: t.nullable(t.num), retPct: t.nullable(t.num),
      maxDrawdown: t.money, ddPct: t.nullable(t.num), streaks: t.object({ maxWins: t.int, maxLosses: t.int }),
    }),
    bestDay: t.nullable(t.object({ date: t.date, net: t.money })),
    worstDay: t.nullable(t.object({ date: t.date, net: t.money })),
    crowns: t.object({ day: t.int, week: t.int, month: t.int, points: t.int, streak: streak, awards: t.array(t.object({ kind: t.enum("day", "week", "month"), period: t.str })) }),
    form: t.array(t.object({
      date: t.date, status: t.enum("ok", "quiet", "partial", "unverified", "prefunding"), n: t.int, net: t.nullable(t.money),
      score: t.nullable(t.num), rank: t.nullable(t.int), crowned: t.bool,
    })),
    pairs: t.array(t.object({ symbol: t.symbol, n: t.int, net: t.money })),
    hours: t.object({ basis: t.enum("entry-of-closes"), buckets: t.array(t.object({ h: t.hour, n: t.int })), earlier: t.int, unknown: t.int, total: t.int }),
  }),
  index: t.object({
    schema: t.enum(1),
    zone: t.str,
    seasonStart: t.date,
    tip: t.nullable(t.object({ seq: t.int, date: t.date, sha256: t.hex64 })),
    days: t.array(t.object({
      date: t.date, seq: t.int, kind: t.enum("nightly", "catchup", "backfilled"), status: t.enum("complete", "partial"),
      sha256: t.hex64, n: t.int, net: t.money, crown: t.nullable(t.key),
    })),
    gaps: t.array(t.date),
    accounts: t.array(t.object({ key: t.key, label: t.str, fundedDate: t.date })),
  }),
  series: t.object({
    schema: t.enum(1),
    seasonStart: t.date,
    days: t.array(t.object({
      date: t.date,
      desk: t.object({ n: t.int, net: t.money, cum: t.money }),
      accounts: t.map(t.key, t.object({
        status: t.enum("ok", "quiet", "partial", "unverified", "prefunding"), n: t.int, net: t.nullable(t.money), cum: t.nullable(t.money),
      })),
    })),
  }),
};

export function project(kind, value) {
  const schema = SCHEMAS[kind];
  if (!schema) throw new ProjectionError(`no public schema named ${kind}`);
  return schema(value, "$");
}

export { FILE_PATH };
