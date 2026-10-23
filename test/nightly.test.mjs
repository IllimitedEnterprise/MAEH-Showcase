import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness } from "../scripts/lib/harness.mjs";
import { saveAccountsMap } from "../scripts/lib/ledger.mjs";
import { runNightly } from "../scripts/lib/nightly.mjs";
import { dayWindow } from "../scripts/lib/time.mjs";
import { errorsOf, formatFinding, verifyRoot } from "../scripts/lib/verify.mjs";
import { RULES } from "./helpers/days.mjs";
import { profile, progressPayload, startFakeHarness } from "./helpers/fake-harness.mjs";
import { gitAvailable, makeRepo, writeLedger } from "./helpers/repo.mjs";

const available = Boolean(gitAvailable());
const NOW = Date.parse("2026-10-22T23:12:00Z"); // 01:12 on the 23rd in Berlin
const DAY = "2026-10-22";
const window = dayWindow(DAY, "Europe/Berlin");
const at = (hours) => window.startSec + hours * 3600;
const noSleep = async () => {};
const rulesFor = (version) => (version === "v1" ? RULES : null);

const trades = (list) => list.map(([ticket, hours, net]) => ({ ticket, at: at(hours), net }));
const OK_PROGRESS = {
  "acc-A": progressPayload({ trades: trades([[1, 1, 40], [2, 2, 30], [3, 3, 50], [4, 4, -10]]), fromSec: window.startSec - 3600 }),
  "acc-B": progressPayload({ trades: trades([[5, 1, 1], [6, 2, 1], [7, 3, 1]]), fromSec: window.startSec - 3600 }),
  "acc-L": progressPayload({ trades: [], fromSec: window.startSec - 3600 }),
};
const ROSTER = [profile("acc-A", "Alpha"), profile("acc-B", "Beta"), profile("acc-L", "Late")];

async function night(repo, { argv = {}, now = () => NOW, sleep = noSleep, scenario = {}, harnessUp = true } = {}) {
  const fake = harnessUp ? await startFakeHarness({ accounts: ROSTER, progress: OK_PROGRESS, ...scenario }) : null;
  const env = { ...repo.env, MAEH_HARNESS_URL: fake ? fake.url : "http://127.0.0.1:9" };
  try {
    return await runNightly({
      root: repo.root, argv, env, now, sleep,
      makeClient: (url) => createHarness({ baseUrl: url, retryDelaysMs: [], timeoutMs: 3_000, sleep: noSleep }),
    });
  } finally {
    await fake?.close();
  }
}

const head = (repo) => repo.git.headSha();
const subject = (repo) => repo.git.exec(["log", "-1", "--format=%s"]).stdout.trim();
const body = (repo) => repo.git.exec(["log", "-1", "--format=%b"]).stdout;
const remoteHead = (repo) => repo.git.exec(["--git-dir", repo.bare, "rev-parse", "main"]).stdout.trim();
const read = (repo, ...parts) => readFileSync(join(repo.root, ...parts), "utf8");
const lastJson = (result) => JSON.parse(result.text.trim().split("\n").at(-1));
const problems = (repo) => errorsOf(verifyRoot(repo.root, { rulesFor }).findings).map(formatFinding);

async function withRepo(options, run) {
  const repo = makeRepo(options);
  try { return await run(repo); } finally { repo.cleanup(); }
}

const skip = available ? {} : { skip: "git is not available here" };

test("a clean night freezes yesterday, verifies, commits with a clear message, and pushes", skip, () => withRepo({}, async (repo) => {
  const result = await night(repo);
  assert.equal(result.exitCode, 0, result.text);
  assert.deepEqual(result.final, { wakeAgent: false, outcome: "frozen", frozen: [DAY], pushed: true, attention: [] });
  assert.deepEqual(lastJson(result), result.final, "the last line is the JSON the scheduler reads");
  assert.equal(subject(repo), `freeze: ${DAY} (nightly, 2/2 account-days clean)`);
  assert.equal(remoteHead(repo), head(repo));
  const manifest = JSON.parse(read(repo, "results", "2026", "10", DAY, "day.json"));
  assert.deepEqual([manifest.kind, manifest.seq, manifest.status], ["nightly", 3, "complete"]);
  assert.deepEqual(repo.git.dirty(["results", "stars"]), []);
  assert.deepEqual(problems(repo), []);
  assert.equal(JSON.parse(read(repo, "results", "index.json")).tip.date, DAY);
  assert.equal(JSON.parse(readFileSync(join(repo.state, "captures.json"), "utf8")).Alpha.balanceCents, 5_000_000);
  assert.equal(JSON.parse(readFileSync(join(repo.state, "last-run.json"), "utf8")).exit, 0);
  assert.ok(!existsSync(join(repo.state, "lock")), "the lock is released");
}));

test("run again straight away: nothing to do, no new commit, no wake", skip, () => withRepo({}, async (repo) => {
  await night(repo);
  const before = head(repo);
  const again = await night(repo);
  assert.deepEqual(again.final, { wakeAgent: false, outcome: "noop", frozen: [], pushed: false, attention: [] });
  assert.equal(head(repo), before);
}));

test("on a health-check day the agent is woken even though the night was clean", skip, () => withRepo({ healthWakeDays: ["Fri"] }, async (repo) => {
  const result = await night(repo); // 01:12 on Friday 2026-10-23
  assert.equal(result.final.outcome, "frozen");
  assert.deepEqual(result.final.attention, []);
  assert.equal(result.final.wakeAgent, true);
}));

test("--status looks and touches nothing, and never wakes the agent", skip, () => withRepo({ healthWakeDays: ["Fri"] }, async (repo) => {
  const before = head(repo);
  const result = await night(repo, { argv: { status: true } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.final.wakeAgent, false);
  assert.match(result.text, /frozen days: 2, latest 2026-10-21 \(seq 2\)/);
  assert.match(result.text, /pending: 2026-10-22/);
  assert.equal(head(repo), before);
  assert.ok(!existsSync(join(repo.root, "results", "2026", "10", DAY)));
}));

test("--dry-run renders and says what it would do, and writes nothing", skip, () => withRepo({}, async (repo) => {
  const result = await night(repo, { argv: { dryRun: true } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.final.outcome, "dry-run");
  assert.match(result.text, /2026-10-22: would freeze as nightly, complete, desk net 113, 7 closes/);
  assert.ok(!existsSync(join(repo.root, "results", "2026", "10", DAY)));
  assert.ok(!existsSync(join(repo.state, "lock")));
}));

test("harness down but the ledger written after the day ended: frozen from the ledger, no fuss", skip, () => withRepo({}, async (repo) => {
  saveAccountsMap(repo.state, [{ id: "acc-A", label: "Alpha" }, { id: "acc-B", label: "Beta" }, { id: "acc-L", label: "Late" }], "2026-10-22T00:00:00Z");
  const stamp = window.endSec + 120;
  writeLedger(repo.varDir, "acc-A", [
    { ticket: 1, closedAt: at(1), openedAt: at(1) - 600, netProfit: 40 }, { ticket: 2, closedAt: at(2), openedAt: at(2) - 600, netProfit: 30 },
    { ticket: 3, closedAt: at(3), openedAt: at(3) - 600, netProfit: 50 }, { ticket: 4, closedAt: at(4), openedAt: at(4) - 600, netProfit: -10 },
  ], { mtimeSec: stamp });
  writeLedger(repo.varDir, "acc-B", [
    { ticket: 5, closedAt: at(1), openedAt: at(1) - 600, netProfit: 1 }, { ticket: 6, closedAt: at(2), openedAt: at(2) - 600, netProfit: 1 },
    { ticket: 7, closedAt: at(3), openedAt: at(3) - 600, netProfit: 1 },
  ], { mtimeSec: stamp });
  const result = await night(repo, { harnessUp: false });
  assert.equal(result.exitCode, 0, result.text);
  assert.deepEqual(result.final.frozen, [DAY]);
  assert.deepEqual(result.final.attention, []);
  const summary = JSON.parse(read(repo, "results", "2026", "10", DAY, "accounts", "Alpha", "summary.json"));
  assert.deepEqual([summary.source, summary.n, summary.net], ["ledger", 4, 110]);
}));

test("harness down and a ledger that predates the day's end: nothing frozen, exit 2, nothing committed", skip, () => withRepo({}, async (repo) => {
  saveAccountsMap(repo.state, [{ id: "acc-A", label: "Alpha" }, { id: "acc-B", label: "Beta" }], "2026-10-22T00:00:00Z");
  writeLedger(repo.varDir, "acc-A", [{ ticket: 1, closedAt: at(1), openedAt: at(1) - 600, netProfit: 40 }], { mtimeSec: window.startSec + 600 });
  writeLedger(repo.varDir, "acc-B", [{ ticket: 5, closedAt: at(1), openedAt: at(1) - 600, netProfit: 1 }], { mtimeSec: window.startSec + 600 });
  const before = head(repo);
  const result = await night(repo, { harnessUp: false });
  assert.equal(result.exitCode, 2);
  assert.equal(result.final.outcome, "unavailable");
  assert.equal(result.final.wakeAgent, true);
  assert.match(result.final.attention[0], /2026-10-22: no complete source for 2 account\(s\); not frozen/);
  assert.equal(head(repo), before);
}));

test("an account that cannot be read blocks the day until someone accepts it as partial, with a reason", skip, () => withRepo({}, async (repo) => {
  const scenario = { progress: { ...OK_PROGRESS, "acc-B": { status: 409, code: "NO_ACTIVE_ACCOUNT_RUNTIME" } } };
  const blocked = await night(repo, { scenario });
  assert.equal(blocked.exitCode, 2);
  assert.deepEqual(blocked.final.frozen, []);

  const accepted = await night(repo, { scenario, argv: { acceptPartial: DAY, reason: "terminal was being rebuilt" } });
  assert.equal(accepted.exitCode, 0, accepted.text);
  assert.deepEqual(accepted.final.frozen, [DAY]);
  assert.equal(accepted.final.wakeAgent, true, "a partial day always draws a look");
  assert.match(accepted.final.attention[0], /1 account\(s\) are partial or unverified/);
  const beta = JSON.parse(read(repo, "results", "2026", "10", DAY, "accounts", "Beta", "summary.json"));
  assert.deepEqual([beta.status, beta.source, beta.n], ["partial", "none", 0]);
  assert.match(body(repo), /accepted as partial: terminal was being rebuilt/);
  assert.equal(JSON.parse(read(repo, "results", "2026", "10", DAY, "day.json")).status, "partial");
  assert.deepEqual(problems(repo), []);
}));

test("accepting a partial day that is not pending is refused", skip, () => withRepo({}, async (repo) => {
  const result = await night(repo, { argv: { acceptPartial: "2026-10-21", reason: "x" } });
  assert.equal(result.exitCode, 5);
  assert.match(result.final.attention[0], /2026-10-21 is not a pending day/);
}));

test("an active account the published list does not know is reported and never published", skip, () => withRepo({}, async (repo) => {
  const scenario = { accounts: [...ROSTER, profile("acc-Z", "Zed")] };
  const result = await night(repo, { scenario });
  assert.equal(result.exitCode, 0);
  assert.match(result.final.attention.join("|"), /1 active account\(s\) are not on the published list/);
  assert.ok(!existsSync(join(repo.root, "results", "2026", "10", DAY, "accounts", "Zed")));
  assert.ok(!read(repo, "results", "2026", "10", DAY, "desk.json").includes("Zed"));
}));

test("a frozen day that was tampered with and committed stops the night before it freezes anything", skip, () => withRepo({}, async (repo) => {
  const file = join("results", "2026", "10", "2026-10-21", "accounts", "Alpha", "trades.json");
  writeFileSync(join(repo.root, file), read(repo, file).replace('"net": 40', '"net": 400'));
  repo.git.add([file]);
  repo.git.exec(["-c", "core.hooksPath=nowhere", "commit", "-q", "-m", "hostile edit"]);
  const before = head(repo);
  const result = await night(repo);
  assert.equal(result.exitCode, 3);
  assert.equal(result.final.outcome, "integrity");
  assert.match(result.text, /2026-10-21 accounts\/Alpha\/trades\.json: content does not match its recorded SHA-256/);
  assert.equal(head(repo), before);
}));

test("uncommitted changes in a managed folder: leave them alone and say so", skip, () => withRepo({}, async (repo) => {
  mkdirSync(join(repo.root, "results", "2026", "10", "2026-10-30"), { recursive: true });
  writeFileSync(join(repo.root, "results", "2026", "10", "2026-10-30", "x.txt"), "half a day");
  const result = await night(repo);
  assert.equal(result.exitCode, 5);
  assert.match(result.final.attention[0], /uncommitted change\(s\) in results or stars/);
}));

test("off the main branch the job does nothing", skip, () => withRepo({}, async (repo) => {
  repo.git.exec(["checkout", "-q", "-b", "feature"]);
  const result = await night(repo);
  assert.equal(result.exitCode, 5);
  assert.match(result.final.attention[0], /not on the main branch \(on feature\)/);
}));

test("the very first run refuses: history comes from the backfill, not from the nightly job", skip, () => withRepo({ seed: [] }, async (repo) => {
  const result = await night(repo);
  assert.equal(result.exitCode, 5);
  assert.match(result.final.attention[0], /no frozen days yet/);
}));

test("a push that fails leaves the commit safe, exits 4, and --retry-push finishes the job", skip, () => withRepo({}, async (repo) => {
  const moved = `${repo.bare}-away`;
  renameSync(repo.bare, moved);
  const failed = await night(repo);
  assert.equal(failed.exitCode, 4);
  assert.equal(failed.final.outcome, "committed-not-pushed");
  assert.equal(failed.final.pushed, false);
  assert.equal(subject(repo), `freeze: ${DAY} (nightly, 2/2 account-days clean)`);
  assert.equal(failed.final.wakeAgent, true);

  renameSync(moved, repo.bare);
  const retried = await night(repo, { argv: { retryPush: true } });
  assert.equal(retried.exitCode, 0, retried.text);
  assert.equal(retried.final.pushed, true);
  assert.equal(remoteHead(repo), head(repo));
}));

test("with no remote at all the commit stays local and that is not an error", skip, () => withRepo({ remote: false }, async (repo) => {
  const result = await night(repo);
  assert.equal(result.exitCode, 0, result.text);
  assert.equal(result.final.pushed, false);
  assert.match(result.text, /no remote to push to/);
}));

test("another run in progress: back off quietly", skip, () => withRepo({ healthWakeDays: ["Fri"] }, async (repo) => {
  writeFileSync(join(repo.state, "lock"), JSON.stringify({ pid: process.pid, startedAt: NOW }));
  const result = await night(repo);
  assert.equal(result.exitCode, 0);
  assert.deepEqual([result.final.outcome, result.final.wakeAgent], ["busy", false]);
  assert.deepEqual(repo.git.dirty(["results", "stars"]), []);
}));

test("just after midnight the job waits for the day to settle, then freezes it as a nightly", skip, () => withRepo({}, async (repo) => {
  let clock = Date.parse("2026-10-22T22:10:00Z"); // 00:10 local: yesterday ended 10 minutes ago
  const sleeps = [];
  const result = await night(repo, { now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  assert.equal(result.exitCode, 0, result.text);
  assert.equal(sleeps[0], 20 * 60_000, "waits until 30 minutes after the day ended");
  assert.deepEqual(result.final.frozen, [DAY]);
  assert.equal(JSON.parse(read(repo, "results", "2026", "10", DAY, "day.json")).kind, "nightly");
}));

test("freezing a Sunday after the clocks went back: a 25 hour day, and the week's chain tag", skip, () => withRepo({
  seasonStart: "2026-10-22", seed: ["2026-10-22", "2026-10-23", "2026-10-24"],
}, async (repo) => {
  const sunday = dayWindow("2026-10-25", "Europe/Berlin");
  assert.equal(sunday.hours, 25);
  const scenario = { progress: {
    "acc-A": progressPayload({ trades: [[1, 3, 40], [2, 4, 30], [3, 5, 50], [4, 6, -10]].map(([ticket, hours, net]) => ({ ticket, at: sunday.startSec + hours * 3600, net })), fromSec: sunday.startSec - 3600 }),
    "acc-B": progressPayload({ trades: [], fromSec: sunday.startSec - 3600 }),
    "acc-L": progressPayload({ trades: [], fromSec: sunday.startSec - 3600 }),
  } };
  const result = await night(repo, { now: () => Date.parse("2026-10-26T00:12:00Z"), scenario });
  assert.equal(result.exitCode, 0, result.text);
  assert.deepEqual(result.final.frozen, ["2026-10-25"]);
  const hours = JSON.parse(read(repo, "results", "2026", "10", "2026-10-25", "accounts", "Alpha", "hours.json"));
  assert.equal(hours.buckets.length, 25);
  assert.equal(JSON.parse(read(repo, "results", "2026", "10", "2026-10-25", "day.json")).window.hours, 25);
  assert.ok(repo.git.tagExists("chain-2026-W43"));
  assert.match(repo.git.exec(["--git-dir", repo.bare, "tag"]).stdout, /chain-2026-W43/, "the tag was pushed too");
}));

test("a missed night is caught up: two pending days are frozen oldest first, the older as a catch-up", skip, () => withRepo({}, async (repo) => {
  const nextDay = dayWindow("2026-10-23", "Europe/Berlin");
  const scenario = { progress: {
    "acc-A": progressPayload({ trades: [{ ticket: 11, at: nextDay.startSec + 7200, net: 5 }], fromSec: window.startSec - 3600 }),
    "acc-B": progressPayload({ trades: [], fromSec: window.startSec - 3600 }),
    "acc-L": progressPayload({ trades: [], fromSec: window.startSec - 3600 }),
  } };
  saveAccountsMap(repo.state, [{ id: "acc-A", label: "Alpha" }, { id: "acc-B", label: "Beta" }], "2026-10-22T00:00:00Z");
  writeLedger(repo.varDir, "acc-A", [
    { ticket: 1, closedAt: at(1), openedAt: at(1) - 600, netProfit: 40 }, { ticket: 2, closedAt: at(2), openedAt: at(2) - 600, netProfit: 30 },
    { ticket: 3, closedAt: at(3), openedAt: at(3) - 600, netProfit: 50 }, { ticket: 4, closedAt: at(4), openedAt: at(4) - 600, netProfit: -10 },
  ], { mtimeSec: nextDay.endSec + 10 });
  writeLedger(repo.varDir, "acc-B", [], { mtimeSec: nextDay.endSec + 10 });
  const result = await night(repo, { now: () => Date.parse("2026-10-23T23:12:00Z"), scenario });
  assert.equal(result.exitCode, 0, result.text);
  assert.deepEqual(result.final.frozen, ["2026-10-22", "2026-10-23"]);
  const kinds = ["2026-10-22", "2026-10-23"].map((date) => JSON.parse(read(repo, "results", "2026", "10", date, "day.json")).kind);
  assert.deepEqual(kinds, ["catchup", "nightly"]);
  assert.match(subject(repo), /^freeze: 2026-10-22, 2026-10-23 \(catchup\/nightly,/);
  assert.deepEqual(problems(repo), []);
}));
