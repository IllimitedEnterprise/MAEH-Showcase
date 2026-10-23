import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerDir, loadAccountsMap, readAnchor, readLedger, saveAccountsMap } from "../scripts/lib/ledger.mjs";

const row = (ticket, closedAt, netProfit) => JSON.stringify({ schema: 1, ticket, symbol: "EURUSD", closedAt, netProfit });

function scratch(run) {
  const dir = mkdtempSync(join(tmpdir(), "maeh-ledger-"));
  return Promise.resolve(run(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("a clean ledger is read in full, with its modification time", () => scratch(async (dir) => {
  const live = ledgerDir(dir, "abc");
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, "broker-closes.ndjson"), `${row(1, 100, 5)}\n${row(2, 200, -3)}\n`);
  utimesSync(join(live, "broker-closes.ndjson"), 1_700_000_000, 1_700_000_000);
  const result = await readLedger(live);
  assert.equal(result.rows.length, 2);
  assert.equal(result.badLines, 0);
  assert.equal(result.torn, false);
  assert.equal(result.mtimeSec, 1_700_000_000);
}));

test("a half-written last line is retried once and then picked up if it completed", () => scratch(async (dir) => {
  const live = ledgerDir(dir, "abc");
  mkdirSync(live, { recursive: true });
  const file = join(live, "broker-closes.ndjson");
  const full = `${row(1, 100, 5)}\n${row(2, 200, -3)}\n`;
  writeFileSync(file, `${row(1, 100, 5)}\n{"schema":1,"ticket":2,"clo`);
  let reads = 0;
  const readFile = (path) => { reads += 1; return reads === 1 ? `${row(1, 100, 5)}\n{"schema":1,"ticket":2,"clo` : full; };
  const result = await readLedger(live, { sleep: async () => {}, readFile });
  assert.equal(reads, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.torn, false);
}));

test("a tail that stays torn is ignored and reported, not fatal", () => scratch(async (dir) => {
  const live = ledgerDir(dir, "abc");
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, "broker-closes.ndjson"), `${row(1, 100, 5)}\n{"broken`);
  const result = await readLedger(live, { sleep: async () => {} });
  assert.equal(result.rows.length, 1);
  assert.equal(result.torn, true);
}));

test("a bad line in the middle is counted and skipped", () => scratch(async (dir) => {
  const live = ledgerDir(dir, "abc");
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, "broker-closes.ndjson"), `${row(1, 100, 5)}\nnot json\n${row(2, 200, 1)}\n`);
  const result = await readLedger(live);
  assert.equal(result.rows.length, 2);
  assert.equal(result.badLines, 1);
  assert.equal(result.torn, false);
}));

test("the funding anchor becomes cents and whole seconds; a missing or broken one is null", () => scratch((dir) => {
  const live = ledgerDir(dir, "abc");
  mkdirSync(live, { recursive: true });
  assert.equal(readAnchor(live), null);
  writeFileSync(join(live, "broker-closes-account.json"), JSON.stringify({ deposits: 50000, fundingAt: 1_790_000_000.4, currency: "EUR", observedAt: "x" }));
  assert.deepEqual(readAnchor(live), { fundingCents: 5_000_000, fundingAtSec: 1_790_000_000, currency: "EUR" });
  writeFileSync(join(live, "broker-closes-account.json"), "{broken");
  assert.equal(readAnchor(live), null);
}));

test("the label-to-id map is kept in the state folder and merged, never in the repository", () => scratch((dir) => {
  assert.deepEqual(loadAccountsMap(dir), {});
  saveAccountsMap(dir, [{ id: "id-1", label: "Alpha" }], "2026-10-23T00:00:00Z");
  const merged = saveAccountsMap(dir, [{ id: "id-2", label: "Beta" }], "2026-10-24T00:00:00Z");
  assert.deepEqual(Object.keys(merged).sort(), ["Alpha", "Beta"]);
  assert.equal(loadAccountsMap(dir).Alpha.id, "id-1");
  writeFileSync(join(dir, "accounts-map.json"), "[]");
  assert.deepEqual(loadAccountsMap(dir), {});
}));
