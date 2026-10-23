import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureAccount, neededDays } from "../scripts/lib/capture.mjs";
import { createHarness } from "../scripts/lib/harness.mjs";
import { dayWindow } from "../scripts/lib/time.mjs";
import { profile, progressPayload, startFakeHarness } from "./helpers/fake-harness.mjs";

const ZONE = "Europe/Berlin";
const window = dayWindow("2026-10-22", ZONE);
const nowSec = Date.parse("2026-10-22T23:10:00Z") / 1000; // 01:10 local on the 23rd
const account = { key: "Alpha", label: "Alpha" };
const roster = { id: "acc-1", label: "Alpha", active: true, state: "healthy", refreshing: false };
const at = (hours) => window.startSec + hours * 3600;

const apiTrade = (ticket, hours, net, extra = {}) => ({ ticket, at: at(hours), net, ...extra });
const ledgerRow = (ticket, hours, netProfit, extra = {}) => ({
  schema: 1, ticket, symbol: "EURUSD", type: 0, direction: "LONG", closedAt: at(hours), openedAt: at(hours) - 900, netProfit, ...extra,
});

function ledgerFolder(dir, rows, { mtimeSec = nowSec, anchor = { deposits: 50000, fundingAt: window.startSec - 86400 * 20, currency: "EUR" } } = {}) {
  const live = join(dir, "live");
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, "broker-closes.ndjson"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  utimesSync(join(live, "broker-closes.ndjson"), mtimeSec, mtimeSec);
  if (anchor) writeFileSync(join(live, "broker-closes-account.json"), JSON.stringify(anchor));
  return live;
}

async function run(scenario, options = {}, body) {
  const dir = mkdtempSync(join(tmpdir(), "maeh-capture-"));
  const fake = await startFakeHarness({ accounts: [profile("acc-1", "Alpha")], ...scenario });
  const client = createHarness({ baseUrl: fake.url, timeoutMs: 2_000, retryDelaysMs: [], sleep: async () => {} });
  try {
    return await body({ dir, client, fake });
  } finally {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const common = { account, window, nowSec, rosterEntry: roster, sleep: async () => {}, deltaRetryMs: 0 };

test("the live read asks for enough days to reach the start of the day, and no more than three", () => {
  assert.equal(neededDays(window, nowSec), 2);
  assert.equal(neededDays(dayWindow("2026-10-23", ZONE), nowSec), 1);
  assert.equal(neededDays(dayWindow("2026-10-17", ZONE), nowSec), 7);
});

test("both sources agree: one complete day, source 'both', no problems", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10), apiTrade(2, 5, -4)], fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ dir, client }) => {
  const live = ledgerFolder(dir, [ledgerRow(1, 3, 10), ledgerRow(2, 5, -4)]);
  const result = await captureAccount({ ...common, client, liveDir: live });
  assert.equal(result.usable, true);
  assert.equal(result.source, "both");
  assert.equal(result.closes.length, 2);
  assert.deepEqual(result.problems, []);
  assert.equal(result.fundingCents, 5_000_000);
  assert.equal(result.balanceCents, 5_000_000);
  assert.equal(result.captureRecord.sec, nowSec);
}));

test("no ledger configured: the live read alone is complete when it reaches the day and is not truncated", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10)], fromSec: nowSec - 2 * 86400, deposits: 50000 }) },
}, {}, async ({ client }) => {
  const result = await captureAccount({ ...common, client, liveDir: null });
  assert.equal(result.usable, true);
  assert.equal(result.source, "api");
  assert.equal(result.fundingCents, 5_000_000);
}));

test("a live read that does not reach the start of the day is not complete", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10)], fromSec: window.startSec + 3600 }) },
}, {}, async ({ client }) => {
  const result = await captureAccount({ ...common, client, liveDir: null });
  assert.equal(result.usable, false);
  assert.deepEqual(result.problems.map((problem) => problem.code), ["no-complete-source"]);
}));

test("live read down, ledger written after the day ended: usable from the ledger, with a note", () => run({
  progress: { "acc-1": { status: 503, code: "TERMINAL_OFFLINE" } },
}, {}, async ({ dir, client }) => {
  const live = ledgerFolder(dir, [ledgerRow(1, 3, 10)], { mtimeSec: window.endSec + 60 });
  const result = await captureAccount({ ...common, client, liveDir: live });
  assert.equal(result.usable, true);
  assert.equal(result.source, "ledger");
  assert.equal(result.closes.length, 1);
  assert.deepEqual(result.problems.map((problem) => problem.code), ["api-unavailable", "ledger-source"]);
  assert.equal(result.problems[0].detail, "TERMINAL_OFFLINE");
  assert.equal(result.captureRecord, null);
}));

test("live read down and the ledger older than the day's end: not usable, because nothing proves it is current", () => run({
  progress: { "acc-1": { status: 503, code: "TERMINAL_OFFLINE" } },
}, {}, async ({ dir, client }) => {
  const live = ledgerFolder(dir, [ledgerRow(1, 3, 10)], { mtimeSec: window.startSec + 600 });
  const result = await captureAccount({ ...common, client, liveDir: live });
  assert.equal(result.usable, false);
  assert.ok(result.problems.some((problem) => problem.code === "ledger-stale"));
  assert.ok(result.problems.some((problem) => problem.code === "no-complete-source" && problem.severity === "blocking"));
}));

test("a truncated live read is rescued by a fresh ledger; without one it is blocking", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(2, 5, -4)], truncated: true, fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ dir, client }) => {
  const live = ledgerFolder(dir, [ledgerRow(1, 3, 10), ledgerRow(2, 5, -4)]);
  const rescued = await captureAccount({ ...common, client, liveDir: live });
  assert.equal(rescued.usable, true);
  assert.equal(rescued.closes.length, 2);
  const alone = await captureAccount({ ...common, client, liveDir: null });
  assert.equal(alone.usable, false);
  assert.deepEqual(alone.problems.map((problem) => problem.code), ["api-truncated"]);
}));

test("a close only the ledger has means the terminal forgot it: kept, and raised as attention", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10)], fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ dir, client }) => {
  const live = ledgerFolder(dir, [ledgerRow(1, 3, 10), ledgerRow(9, 6, 7)]);
  const result = await captureAccount({ ...common, client, liveDir: live });
  assert.equal(result.closes.length, 2);
  const problem = result.problems.find((entry) => entry.code === "terminal-forgot");
  assert.deepEqual([problem.n, problem.severity, problem.attention], [1, "note", true]);
}));

test("a close with no recorded result makes the account-day partial", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10), apiTrade(2, 4, null)], fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ client }) => {
  const result = await captureAccount({ ...common, client, liveDir: null });
  const problem = result.problems.find((entry) => entry.code === "null-result");
  assert.deepEqual([problem.n, problem.severity], [1, "partial"]);
}));

test("a day beyond the live window is read from the ledger; the live read only proves freshness", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10)], fromSec: nowSec - 3 * 86400 }) },
}, {}, async ({ dir, client, fake }) => {
  const oldWindow = dayWindow("2026-10-17", ZONE);
  const live = ledgerFolder(dir, [{ ...ledgerRow(5, 3, 3), closedAt: oldWindow.startSec + 3 * 3600, openedAt: oldWindow.startSec + 1000 }], { mtimeSec: nowSec - 5 * 86400 });
  const result = await captureAccount({ ...common, window: oldWindow, client, liveDir: live });
  assert.equal(result.usable, true);
  assert.equal(result.source, "ledger");
  assert.equal(result.closes.length, 1);
  assert.equal(fake.calls.find((call) => call.path === "/api/v1/account/progress").query.days, "3");
}));

test("an inactive account is not read live; a ledger written after the day is still usable", () => run({}, {}, async ({ dir, client, fake }) => {
  const live = ledgerFolder(dir, [ledgerRow(1, 3, 10)], { mtimeSec: window.endSec + 5 });
  const result = await captureAccount({ ...common, rosterEntry: { ...roster, active: false }, client, liveDir: live });
  assert.equal(result.usable, true);
  assert.ok(result.problems.some((problem) => problem.code === "api-skipped"));
  assert.equal(fake.calls.filter((call) => call.path === "/api/v1/account/progress").length, 0);
}));

test("the balance chain: balance moved by exactly the closes since the last capture", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10), apiTrade(2, 5, 15)], balance: 50025, fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ client }) => {
  const previousCapture = { sec: at(1), balanceCents: 5_000_000 };
  const ok = await captureAccount({ ...common, client, liveDir: null, previousCapture });
  assert.equal(ok.delta.ok, true);
  assert.ok(!ok.problems.some((problem) => problem.code === "balance-gap"));
}));

test("the balance chain: a deposit or a missed close shows as a gap, after one second look", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, 3, 10)], balance: 51010, fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ client, fake }) => {
  const previousCapture = { sec: at(1), balanceCents: 5_000_000 };
  const result = await captureAccount({ ...common, client, liveDir: null, previousCapture });
  assert.equal(result.delta.ok, false);
  const problem = result.problems.find((entry) => entry.code === "balance-gap");
  assert.deepEqual([problem.severity, problem.amountCents], ["partial", 100_000]);
  assert.equal(fake.calls.filter((call) => call.path === "/api/v1/account/progress").length, 2);
}));

test("with no previous capture there is nothing to compare, and that is not a problem", () => run({
  progress: { "acc-1": progressPayload({ trades: [], fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ client }) => {
  const result = await captureAccount({ ...common, client, liveDir: null, previousCapture: null });
  assert.equal(result.delta.ok, null);
  assert.deepEqual(result.problems, []);
}));

test("the funding anchor beats the live read's deposit figure, which only covers its own window", () => run({
  progress: { "acc-1": progressPayload({ trades: [], deposits: 123, fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ dir, client }) => {
  const live = ledgerFolder(dir, [], { anchor: { deposits: 50000, fundingAt: window.startSec - 86400, currency: "EUR" } });
  const result = await captureAccount({ ...common, client, liveDir: live });
  assert.equal(result.fundingCents, 5_000_000);
}));

test("only the closes inside the day are returned", () => run({
  progress: { "acc-1": progressPayload({ trades: [apiTrade(1, -2, 99), apiTrade(2, 3, 10), apiTrade(3, 30, 5)], fromSec: nowSec - 2 * 86400 }) },
}, {}, async ({ client }) => {
  const result = await captureAccount({ ...common, client, liveDir: null });
  assert.deepEqual(result.closes.map((close) => close.ticket), [2]);
}));
