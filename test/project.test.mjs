import test from "node:test";
import assert from "node:assert/strict";
import { ProjectionError, project, t } from "../scripts/lib/project.mjs";

const summary = () => ({
  schema: 1, date: "2026-10-22", key: "M9-B-CHERRY", label: "M9-B-CHERRY", status: "ok", reasons: [],
  source: "api", currency: "EUR", funding: 50000, n: 3, wins: 2, losses: 1, breakevens: 0, winRatePct: 66.7,
  grossWin: 30.5, grossLoss: 10, net: 20.5, profitFactor: 3.05, retPct: 0.041, maxDrawdown: 10, ddPct: 0.02,
  streaks: { maxWins: 2, maxLosses: 1 }, r: null, best: { symbol: "EURUSD", net: 20, r: null },
  worst: { symbol: "GBPJPY", net: -10, r: -1 }, pairs: [{ symbol: "EURUSD", n: 2, net: 30.5 }],
  chain: { ok: null, gap: null },
});

test("a complete object projects, in the schema's key order", () => {
  const scrambled = Object.fromEntries(Object.entries(summary()).reverse());
  assert.deepEqual(Object.keys(project("summary", scrambled)), Object.keys(summary()));
});

test("an unknown field is refused, never silently dropped", () => {
  assert.throws(() => project("summary", { ...summary(), ticket: 12345 }), /\$\.ticket: field is not on the public allowlist/);
  const nested = summary();
  nested.best = { symbol: "EURUSD", net: 20, r: null, comment: "TUabc" };
  assert.throws(() => project("summary", nested), /\$\.best\.comment/);
});

test("a missing required field is refused", () => {
  const missing = summary();
  delete missing.net;
  assert.throws(() => project("summary", missing), /\$\.net: missing/);
});

test("types are enforced", () => {
  assert.throws(() => project("summary", { ...summary(), n: 3.5 }), ProjectionError);
  assert.throws(() => project("summary", { ...summary(), net: "20" }), ProjectionError);
  assert.throws(() => project("summary", { ...summary(), status: "great" }), /expected one of/);
  assert.throws(() => project("summary", { ...summary(), net: 20.123 }), /more than two decimals/);
  assert.throws(() => project("summary", { ...summary(), winRatePct: NaN }), ProjectionError);
});

test("text is printable ASCII only", () => {
  assert.throws(() => project("summary", { ...summary(), label: "café" }), /printable ASCII/);
  assert.throws(() => project("summary", { ...summary(), label: "a​b" }), /printable ASCII/);
  assert.throws(() => project("summary", { ...summary(), reasons: ["line\nbreak"] }), /printable ASCII/);
  assert.throws(() => project("summary", { ...summary(), key: "has space" }), /folder-safe key/);
});

test("nullable fields accept null and reject undefined", () => {
  assert.equal(project("summary", { ...summary(), profitFactor: null }).profitFactor, null);
  const undef = { ...summary(), profitFactor: undefined };
  assert.throws(() => project("summary", undef), /missing/);
});

test("negative zero is normalised", () => {
  assert.ok(Object.is(project("summary", { ...summary(), net: -0 }).net, 0));
});

test("map schemas check keys as well as values", () => {
  const schema = t.map(t.key, t.int);
  assert.deepEqual(schema({ a: 1 }, "$"), { a: 1 });
  assert.throws(() => schema({ "a b": 1 }, "$"), /folder-safe key/);
  assert.throws(() => schema({ a: "x" }, "$"), /expected an integer/);
});

test("the day manifest requires hashes and a chain link", () => {
  const day = {
    schema: 1, seq: 2, date: "2026-10-22", zone: "Europe/Berlin",
    window: { startUtc: "2026-10-21T22:00:00Z", endUtc: "2026-10-22T22:00:00Z", startOff: "+02:00", endOff: "+02:00", hours: 24 },
    kind: "nightly", status: "complete", capturedAt: "2026-10-22T23:05:00Z", rules: "v1",
    accounts: { "M9-B-CHERRY": "ok" },
    files: { "README.md": { sha256: "a".repeat(64), bytes: 120 } },
    prev: { seq: 1, date: "2026-10-21", sha256: "b".repeat(64) },
  };
  assert.doesNotThrow(() => project("day", day));
  assert.throws(() => project("day", { ...day, files: { "README.md": { sha256: "xyz", bytes: 1 } } }), /64-character/);
  assert.throws(() => project("day", { ...day, kind: "manual" }), /expected one of/);
  assert.equal(project("day", { ...day, prev: null }).prev, null);
});

test("an unknown schema name is an error", () => {
  assert.throws(() => project("nope", {}), /no public schema/);
});
