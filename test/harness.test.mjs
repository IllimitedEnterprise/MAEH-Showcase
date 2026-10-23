import test from "node:test";
import assert from "node:assert/strict";
import {
  HarnessError, createHarness, isRefreshBusy, normalizeProgress, preflight, quarterWaitMs,
} from "../scripts/lib/harness.mjs";
import {
  LEAKY_LOGIN, LEAKY_PATH, LEAKY_SERVER, profile, progressPayload, startFakeHarness,
} from "./helpers/fake-harness.mjs";

const noSleep = async () => {};

async function withHarness(scenario, run, options = {}) {
  const fake = await startFakeHarness(scenario);
  const sleeps = [];
  const client = createHarness({
    baseUrl: fake.url, timeoutMs: 2_000, retryDelaysMs: [20_000, 60_000, 120_000],
    sleep: async (ms) => { sleeps.push(ms); }, ...options,
  });
  try {
    return await run({ client, fake, sleeps });
  } finally {
    await fake.close();
  }
}

test("the roster is reduced on arrival: logins, servers and paths never survive", async () => {
  await withHarness({ accounts: [profile("id-1", "Alpha"), profile("id-2", "Beta", { active: false })] }, async ({ client }) => {
    const roster = await client.accounts();
    assert.deepEqual(roster.accounts, [
      { id: "id-1", label: "Alpha", active: true, state: "healthy", refreshing: false },
      { id: "id-2", label: "Beta", active: false, state: "healthy", refreshing: false },
    ]);
    const text = JSON.stringify(roster);
    for (const secret of [LEAKY_LOGIN, LEAKY_SERVER, LEAKY_PATH, "18880"]) assert.ok(!text.includes(secret), `${secret} leaked`);
  });
});

test("progress passes the account id and the window, and is GET only", async () => {
  await withHarness({ progress: { "id-1": progressPayload({ trades: [{ ticket: 1, at: 1000, net: 5 }] }) } }, async ({ client, fake }) => {
    const result = await client.progress("id-1", 2);
    assert.equal(result.rows.length, 1);
    const call = fake.calls.find((entry) => entry.path === "/api/v1/account/progress");
    assert.deepEqual(call.query, { accountId: "id-1", days: "2" });
    assert.equal(call.method, "GET");
  });
});

test("an empty account id and a long window are refused before any request", async () => {
  await withHarness({}, async ({ client, fake }) => {
    await assert.rejects(() => client.progress("", 2), (error) => error.code === "NO_ACCOUNT");
    await assert.rejects(() => client.progress("id-1", 365), (error) => error.code === "BAD_DAYS");
    await assert.rejects(() => client.progress("id-1", 0), (error) => error.code === "BAD_DAYS");
    assert.equal(fake.calls.length, 0);
  });
});

test("progress is normalised: balance in cents, truncation flagged, rows left raw", () => {
  const payload = progressPayload({ trades: [{ ticket: 1, at: 5, net: 1 }], balance: 50123.45, deposits: 50000, fromSec: 77 });
  const result = normalizeProgress(payload);
  assert.equal(result.balanceCents, 5012345);
  assert.equal(result.fundingCents, 5000000);
  assert.equal(result.currency, "EUR");
  assert.equal(result.rangeFromSec, 77);
  assert.equal(result.truncated, false);
  assert.equal(normalizeProgress(progressPayload({ truncated: true })).truncated, true);
  const many = progressPayload({ trades: Array.from({ length: 500 }, (_, index) => ({ ticket: index, at: index, net: 1 })) });
  assert.equal(normalizeProgress(many).truncated, true, "500 rows is the harness cap, so the window may be cut");
  assert.equal(normalizeProgress({}).rows.length, 0);
});

test("409, 502 and 503 are retried on a 20 s, 60 s, 120 s ladder, then succeed", async () => {
  const sequence = [{ status: 409, code: "NO_ACTIVE_ACCOUNT_RUNTIME" }, { status: 503, code: "TERMINAL_OFFLINE" }, { status: 502, code: "X" }, progressPayload()];
  await withHarness({ progress: { "id-1": sequence } }, async ({ client, sleeps }) => {
    const result = await client.progress("id-1", 2);
    assert.equal(result.rows.length, 0);
    assert.deepEqual(sleeps, [20_000, 60_000, 120_000]);
  });
});

test("when the ladder runs out the last error is thrown, with a code and no body text", async () => {
  await withHarness({ progress: { "id-1": { status: 409, code: "NO_ACTIVE_ACCOUNT_RUNTIME" } } }, async ({ client, sleeps }) => {
    await assert.rejects(() => client.progress("id-1", 2), (error) => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.code, "NO_ACTIVE_ACCOUNT_RUNTIME");
      assert.equal(error.status, 409);
      assert.ok(!error.message.includes(LEAKY_PATH) && !error.message.includes(LEAKY_LOGIN));
      return true;
    });
    assert.equal(sleeps.length, 3);
  });
});

test("an unknown account id is the harness's 409, and a missing route is not retried", async () => {
  await withHarness({}, async ({ client, sleeps }) => {
    await assert.rejects(() => client.progress("ghost", 2), (error) => error.status === 409);
    assert.equal(sleeps.length, 3);
  });
  await withHarness({ progress: { "id-1": { status: 404, code: "NOT_FOUND" } } }, async ({ client, sleeps }) => {
    await assert.rejects(() => client.progress("id-1", 2), (error) => error.status === 404 && !error.retryable);
    assert.equal(sleeps.length, 0);
  });
});

test("a stalled read times out and is retried as retryable", async () => {
  await withHarness({ progress: { "id-1": [{ delayMs: 300, body: progressPayload() }, progressPayload()] } }, async ({ client, sleeps }) => {
    const result = await client.progress("id-1", 2);
    assert.equal(result.rows.length, 0);
    assert.deepEqual(sleeps, [20_000]);
  }, { timeoutMs: 100 });
});

test("a body that is not JSON is an error, not a silent empty day", async () => {
  await withHarness({ progress: { "id-1": { raw: "<html>proxy error</html>" } } }, async ({ client }) => {
    await assert.rejects(() => client.progress("id-1", 2), (error) => error.code === "BAD_BODY");
  });
});

test("a harness that is not on loopback is refused outright", () => {
  assert.throws(() => createHarness({ baseUrl: "http://192.168.1.20:8790" }), /non-loopback/);
  assert.throws(() => createHarness({ baseUrl: "http://example.com" }), /non-loopback/);
  assert.doesNotThrow(() => createHarness({ baseUrl: "http://127.0.0.1:8790" }));
});

test("healthz reports ok or not", async () => {
  await withHarness({ health: true }, async ({ client }) => assert.deepEqual(await client.healthz(), { ok: true }));
  await withHarness({ health: false }, async ({ client }) => assert.deepEqual(await client.healthz(), { ok: false }));
});

test("busy means a refresh is running or an active account is mid-restart", () => {
  const idle = { refreshPhase: "idle", accounts: [{ active: true, refreshing: false }] };
  assert.equal(isRefreshBusy(idle), false);
  assert.equal(isRefreshBusy({ ...idle, refreshPhase: "running" }), true);
  assert.equal(isRefreshBusy({ refreshPhase: "scheduled", accounts: [{ active: true, refreshing: true }] }), true);
  assert.equal(isRefreshBusy({ refreshPhase: "idle", accounts: [{ active: false, refreshing: true }] }), false);
});

test("reads wait until 120 s after a quarter-hour mark", () => {
  const at = (text) => Date.parse(text);
  assert.equal(quarterWaitMs(at("2026-10-23T00:00:30Z")), 90_000);
  assert.equal(quarterWaitMs(at("2026-10-23T00:00:00Z")), 120_000);
  assert.equal(quarterWaitMs(at("2026-10-23T00:02:00Z")), 0);
  assert.equal(quarterWaitMs(at("2026-10-23T00:14:59Z")), 0);
  assert.equal(quarterWaitMs(at("2026-10-23T00:15:01Z")), 119_000);
});

test("preflight waits through a running refresh and then reports quiet", async () => {
  await withHarness({ refreshPhase: ["running", "running", "idle"] }, async ({ client }) => {
    const sleeps = [];
    const clock = { now: Date.parse("2026-10-23T00:05:00Z") };
    const result = await preflight({
      client, now: () => clock.now, pollMs: 30_000,
      sleep: async (ms) => { sleeps.push(ms); clock.now += ms; },
    });
    assert.equal(result.quiet, true);
    assert.deepEqual(sleeps, [30_000, 30_000]);
    assert.equal(result.accounts.length, 1);
  });
});

test("preflight gives up politely when the harness never goes quiet", async () => {
  await withHarness({ refreshPhase: "running" }, async ({ client }) => {
    const clock = { now: Date.parse("2026-10-23T00:05:00Z") };
    const result = await preflight({
      client, now: () => clock.now, pollMs: 30_000, maxWaitMs: 90_000,
      sleep: async (ms) => { clock.now += ms; },
    });
    assert.equal(result.quiet, false);
  });
});

test("preflight throws when the harness is down, so the caller can fall back to the ledger", async () => {
  const client = createHarness({ baseUrl: "http://127.0.0.1:9", timeoutMs: 500, retryDelaysMs: [], sleep: noSleep });
  await assert.rejects(() => preflight({ client, sleep: noSleep }), (error) => error instanceof HarnessError && error.retryable);
});

test("preflight treats a health answer of not-ok as an error", async () => {
  await withHarness({ health: false }, async ({ client }) => {
    await assert.rejects(() => preflight({ client, sleep: noSleep }), (error) => error.code === "NOT_OK");
  });
});
