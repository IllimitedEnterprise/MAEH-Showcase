import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyEverything } from "../scripts/lib/audit.mjs";
import { backfill, initAccounts, planDates, reportLines, survey } from "../scripts/lib/backfill.mjs";
import { HarnessError, createHarness } from "../scripts/lib/harness.mjs";
import { loadContext, rebuildDerived } from "../scripts/lib/pipeline.mjs";
import { dayWindow } from "../scripts/lib/time.mjs";
import { freeze } from "./helpers/days.mjs";
import { profile, progressPayload, startFakeHarness } from "./helpers/fake-harness.mjs";
import { GOOD, gitAvailable, makeRepo, writeLedger } from "./helpers/repo.mjs";

const skip = gitAvailable() ? {} : { skip: "git is not available here" };
const ZONE = "Europe/Berlin";
const NOW = Date.parse("2026-10-23T08:00:00Z") / 1000; // 10:00 local on the 23rd
const noSleep = async () => {};

const at = (date, hours) => dayWindow(date, ZONE).startSec + hours * 3600;
const row = (ticket, date, hours, netProfit) => ({ ticket, closedAt: at(date, hours), openedAt: at(date, hours) - 600, netProfit });
const ANCHOR = { deposits: 50000, fundingAt: Date.parse("2026-10-19T10:00:00Z") / 1000, currency: "EUR" };

const ALPHA = [
  row(1, "2026-10-20", 1, 30), row(2, "2026-10-20", 2, 20), row(3, "2026-10-20", 3, 10),
  row(4, "2026-10-21", 1, 40), row(5, "2026-10-21", 2, 30), row(6, "2026-10-21", 3, 50), row(7, "2026-10-21", 4, -10),
  row(8, "2026-10-22", 1, 40), row(9, "2026-10-22", 2, 30), row(10, "2026-10-22", 3, 50), row(11, "2026-10-22", 4, -10),
]; // net 280
const BETA = [row(21, "2026-10-21", 1, 1), row(22, "2026-10-21", 2, 1), row(23, "2026-10-21", 3, 1)]; // net 3

async function withWorld({ alphaBalance = 50_280, seed = [] }, run) {
  const repo = makeRepo({ seed, remote: false, seasonStart: "2026-10-20" });
  writeLedger(repo.varDir, "acc-A", ALPHA, { anchor: ANCHOR });
  writeLedger(repo.varDir, "acc-B", BETA, { anchor: ANCHOR });
  const fake = await startFakeHarness({
    accounts: [profile("acc-A", "Alpha"), profile("acc-B", "Beta"), profile("acc-L", "Late")],
    progress: {
      "acc-A": progressPayload({ balance: alphaBalance }),
      "acc-B": progressPayload({ balance: 50_003 }),
      "acc-L": progressPayload({ balance: 50_000 }),
    },
  });
  const env = { ...repo.env, MAEH_HARNESS_URL: fake.url };
  const ctx = loadContext(repo.root, env);
  const client = createHarness({ baseUrl: fake.url, timeoutMs: 3_000, retryDelaysMs: [], sleep: noSleep });
  try {
    return await run({ repo, ctx, client, fake });
  } finally {
    await fake.close();
    repo.cleanup();
  }
}

const read = (repo, date, ...parts) => JSON.parse(readFileSync(join(repo.root, "results", "2026", "10", date, ...parts), "utf8"));

test("the survey reads each account's ledger, funding and live balance, and runs the gate", skip, () => withWorld({}, async ({ ctx, client }) => {
  const { surveyed } = await survey({ ctx, client, labels: ["Alpha", "Beta"], nowSec: NOW, sleep: noSleep });
  const alpha = surveyed.find((entry) => entry.label === "Alpha");
  assert.equal(alpha.rows, 11);
  assert.equal(alpha.ledgerNetCents, 28_000);
  assert.equal(alpha.anchor.fundingCents, 5_000_000);
  assert.deepEqual(alpha.gate, { ok: true, gapCents: 0 });
  assert.equal(surveyed.find((entry) => entry.label === "Beta").gate.ok, true);
  const lines = reportLines({ surveyed, zone: ZONE }).join("\n");
  assert.match(lines, /Alpha\s+11\s+2026-10-20\s+2026-10-22\s+2026-10-19\s+50000\.00\s+280\.00\s+50280\.00\s+0\.00\s+ok/);
}));

test("a reconciled account's days are frozen as backfilled, in date order, and everything verifies", skip, () => withWorld({}, async ({ repo, ctx, client }) => {
  const { surveyed } = await survey({ ctx, client, labels: ["Alpha", "Beta", "Late"], nowSec: NOW, sleep: noSleep });
  const dates = planDates({ ctx, nowSec: NOW });
  assert.deepEqual(dates, ["2026-10-20", "2026-10-21", "2026-10-22"]);
  const result = await backfill({ ctx, surveyed, dates, nowSec: NOW });
  assert.deepEqual(result.sealed.map((day) => [day.date, day.seq, day.status]), [["2026-10-20", 1, "complete"], ["2026-10-21", 2, "complete"], ["2026-10-22", 3, "complete"]]);
  const manifest = read(repo, "2026-10-21", "day.json");
  assert.equal(manifest.kind, "backfilled");
  assert.deepEqual(manifest.accounts, { Alpha: "ok", Beta: "ok", Late: "prefunding" });
  assert.deepEqual(read(repo, "2026-10-20", "day.json").accounts, { Alpha: "ok", Beta: "quiet", Late: "prefunding" });
  const alpha = read(repo, "2026-10-21", "accounts", "Alpha", "summary.json");
  assert.deepEqual([alpha.source, alpha.n, alpha.net, alpha.chain], ["ledger", 4, 110, { ok: true, gap: 0 }]);
  assert.equal(verifyEverything({ root: repo.root, ctx }).errors.length, 0);
  assert.equal(read(repo, "2026-10-21", "stars.json").crown.key, "Alpha");
}));

test("an account whose ledger does not add up is published, badged unverified, and kept out of every crown", skip, () => withWorld({ alphaBalance: 50_400 }, async ({ repo, ctx, client }) => {
  const { surveyed } = await survey({ ctx, client, labels: ["Alpha", "Beta", "Late"], nowSec: NOW, sleep: noSleep });
  const alpha = surveyed.find((entry) => entry.label === "Alpha");
  assert.deepEqual(alpha.gate, { ok: false, gapCents: 12_000 });
  assert.match(reportLines({ surveyed, zone: ZONE }).join("\n"), /Alpha .*120\.00\s+UNVERIFIED/);

  await backfill({ ctx, surveyed, dates: planDates({ ctx, nowSec: NOW }), nowSec: NOW });
  const summary = read(repo, "2026-10-21", "accounts", "Alpha", "summary.json");
  assert.equal(summary.status, "unverified");
  assert.match(summary.reasons[0], /differ from the balance by \+120\.00/);
  assert.deepEqual(summary.chain, { ok: false, gap: 120 });
  assert.equal(summary.n, 4, "the figures are still published");
  const stars = read(repo, "2026-10-21", "stars.json");
  assert.equal(stars.crown.key, "Beta", "an unverified account cannot win the crown, so the best verified one does");
  assert.deepEqual(stars.withheld, [{ key: "Alpha", reason: "partial or unverified, so not eligible" }]);
  assert.equal(read(repo, "2026-10-21", "day.json").status, "partial");
  assert.equal(verifyEverything({ root: repo.root, ctx }).errors.length, 0);
}));

test("days that are already frozen are left alone and the range can be narrowed", skip, () => withWorld({ seed: ["2026-10-20"] }, async ({ ctx }) => {
  assert.deepEqual(planDates({ ctx, nowSec: NOW }), ["2026-10-21", "2026-10-22"]);
  assert.deepEqual(planDates({ ctx, nowSec: NOW, from: "2026-10-22" }), ["2026-10-22"]);
  assert.deepEqual(planDates({ ctx, nowSec: NOW, to: "2026-10-21" }), ["2026-10-21"]);
}));

test("the account list is built from the harness's own roster and the funding records", skip, () => withWorld({}, async ({ ctx, client, repo }) => {
  writeLedger(repo.varDir, "acc-L", [], { anchor: { deposits: 50000, fundingAt: Date.parse("2026-10-25T09:00:00Z") / 1000, currency: "EUR" } });
  const accounts = await initAccounts({ ctx, client, nowSec: NOW, write: false });
  assert.deepEqual(accounts, [
    { label: "Alpha", key: "Alpha", fundedDate: "2026-10-19" },
    { label: "Beta", key: "Beta", fundedDate: "2026-10-19" },
    { label: "Late", key: "Late", fundedDate: "2026-10-25" },
  ]);
  await assert.rejects(() => initAccounts({ ctx, client, nowSec: NOW }), /already exists/);
  const written = await initAccounts({ ctx, client, nowSec: NOW, force: true });
  assert.equal(written.length, 3);
  assert.equal(JSON.parse(readFileSync(join(ctx.root, "config", "accounts.json"), "utf8")).accounts[2].fundedDate, "2026-10-25");
}));

test("an account with no funding record cannot be listed yet", skip, () => withWorld({}, async ({ ctx, client }) => {
  await assert.rejects(() => initAccounts({ ctx, client, nowSec: NOW, write: false }), /no funding record for Late/);
}));

test("the survey needs the harness: down means an error, not a guess", skip, () => withWorld({}, async ({ ctx }) => {
  const dead = createHarness({ baseUrl: "http://127.0.0.1:9", timeoutMs: 500, retryDelaysMs: [], sleep: noSleep });
  await assert.rejects(() => survey({ ctx, client: dead, labels: ["Alpha"], nowSec: NOW, sleep: noSleep }), (error) => error instanceof HarnessError);
}));

test("an account the harness does not list is an error", skip, () => withWorld({}, async ({ ctx, client }) => {
  await assert.rejects(() => survey({ ctx, client, labels: ["Nobody"], nowSec: NOW, sleep: noSleep }), /does not list an account called Nobody/);
}));

test("after a backfill the nightly job has a chain to extend", skip, () => withWorld({}, async ({ repo, ctx, client }) => {
  const { surveyed } = await survey({ ctx, client, labels: ["Alpha", "Beta", "Late"], nowSec: NOW, sleep: noSleep });
  await backfill({ ctx, surveyed, dates: planDates({ ctx, nowSec: NOW }), nowSec: NOW });
  const next = freeze(repo.root, "2026-10-23", GOOD, { kind: "nightly" });
  assert.equal(next.sealed.seq, 4);
  const fresh = loadContext(repo.root, repo.env);
  assert.ok(verifyEverything({ root: repo.root, ctx: fresh }).errors.length > 0, "derived files are stale until they are rebuilt");
  rebuildDerived(fresh);
  assert.equal(verifyEverything({ root: repo.root, ctx: fresh }).errors.length, 0);
}));
