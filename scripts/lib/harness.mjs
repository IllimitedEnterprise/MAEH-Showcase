/* A read-only client for the MAEH harness's HTTP API.
 *
 * GET only, loopback only. The harness answers more than this project may keep: /accounts
 * carries broker logins, server names and terminal paths. Everything is reduced to the few
 * fields needed the moment it arrives, so nothing else is ever in memory to leak. Error
 * messages carry a status and a code, never a response body.
 *
 * The harness never cuts days: `days` is a rolling window ending now, so a read for
 * yesterday is `days=2`, and the local day is cut from each close's own time. */

import { toCents } from "./canonical.mjs";

export class HarnessError extends Error {
  constructor(message, { status = null, code = null, retryable = false } = {}) {
    super(message);
    this.name = "HarnessError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const RETRY_STATUSES = new Set([409, 502, 503, 504]);
const TRADE_LIMIT = 500; // the harness keeps only the newest 500 closes in a progress read
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHarness({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120_000,
  retryDelaysMs = [20_000, 60_000, 120_000],
  sleep = wait,
  log = () => {},
} = {}) {
  const base = new URL(baseUrl);
  if (!LOOPBACK.has(base.hostname)) throw new HarnessError(`refusing a non-loopback harness host: ${base.hostname}`);

  async function once(pathname, params) {
    const url = new URL(pathname, base);
    for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, String(value));
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new HarnessError(`harness unreachable (${timedOut ? "timeout" : "network"})`,
        { code: timedOut ? "TIMEOUT" : "NETWORK", retryable: true });
    }
    let text;
    try {
      text = await response.text();
    } catch {
      throw new HarnessError("harness answer was cut off", { code: "TIMEOUT", retryable: true });
    }
    let body = null;
    try {
      body = JSON.parse(text);
    } catch { /* handled below */ }
    if (!response.ok) {
      const code = typeof body?.error?.code === "string" ? body.error.code.slice(0, 64) : null;
      throw new HarnessError(`harness answered ${response.status}${code ? ` ${code}` : ""}`, {
        status: response.status, code, retryable: RETRY_STATUSES.has(response.status) || code === "TERMINAL_OFFLINE",
      });
    }
    if (body === null) throw new HarnessError("harness answered with something that is not JSON", { code: "BAD_BODY" });
    return body;
  }

  async function get(pathname, params) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await once(pathname, params);
      } catch (error) {
        const delay = retryDelaysMs[attempt];
        if (!(error instanceof HarnessError) || !error.retryable || delay === undefined) throw error;
        log(`retry ${attempt + 1} of ${retryDelaysMs.length} in ${Math.round(delay / 1000)} s: ${error.message}`);
        await sleep(delay);
      }
    }
  }

  return {
    async healthz() {
      const body = await get("/healthz");
      return { ok: body?.ok === true };
    },

    /* The roster, reduced on arrival to what a freeze needs. */
    async accounts() {
      const body = await get("/api/v1/accounts");
      const profiles = Array.isArray(body?.profiles) ? body.profiles : [];
      return {
        accounts: profiles.map((profile) => ({
          id: String(profile?.id ?? ""),
          label: String(profile?.label ?? ""),
          active: profile?.active === true,
          state: typeof profile?.runtime?.state === "string" ? profile.runtime.state : "stopped",
          refreshing: profile?.runtime?.refreshing === true,
        })).filter((account) => account.id && account.label),
        refreshPhase: typeof body?.refresh?.phase === "string" ? body.refresh.phase : null,
      };
    },

    async refresh() {
      const body = await get("/api/v1/maintenance/refresh");
      return { enabled: body?.enabled === true, phase: typeof body?.phase === "string" ? body.phase : null };
    },

    /* One account's closed trades for a rolling window. `days` is deliberately small: a long
     * window is slow, hits the 500-row cap, and can make the terminal recycle its sidecar. */
    async progress(accountId, days) {
      if (!accountId) throw new HarnessError("an account id is required: an empty one reads whichever account is on screen", { code: "NO_ACCOUNT" });
      if (!Number.isInteger(days) || days < 1 || days > 7) throw new HarnessError(`days must be 1 to 7, got ${days}`, { code: "BAD_DAYS" });
      return normalizeProgress(await get("/api/v1/account/progress", { accountId, days }));
    },
  };
}

/* The parts of a progress answer the freeze uses. `rows` stay raw: ingest picks fields. */
export function normalizeProgress(body) {
  const rows = Array.isArray(body?.trades) ? body.trades : [];
  return {
    checkedAt: typeof body?.checkedAt === "string" ? body.checkedAt : null,
    currency: typeof body?.accountCurrency === "string" ? body.accountCurrency.slice(0, 12) : null,
    balanceCents: finite(body?.account?.balance) ? toCents(body.account.balance) : null,
    fundingCents: finite(body?.account?.deposits) ? toCents(body.account.deposits) : null,
    rangeFromSec: finite(body?.range?.from) ? body.range.from : null,
    truncated: body?.coverage?.truncated === true || rows.length >= TRADE_LIMIT,
    rows,
  };
}

/* A self-refresh is running, or an active account is being restarted. */
export const isRefreshBusy = ({ refreshPhase, accounts }) =>
  refreshPhase === "running" || accounts.some((account) => account.active && account.refreshing);

/* Milliseconds to wait so a read starts at least `guardSec` after a quarter-hour mark: the
 * desk's candle-close pass runs just after each one and owns the terminal's command lane. */
export function quarterWaitMs(nowMs, guardSec = 120) {
  const intoQuarter = (Math.floor(nowMs / 1000) % 900) + (nowMs % 1000) / 1000;
  return intoQuarter < guardSec ? Math.ceil((guardSec - intoQuarter) * 1000) : 0;
}

/* Wait for the harness to be quiet: not mid-refresh, not just after a quarter-hour. Throws
 * HarnessError when it cannot be reached at all; returns { quiet:false } when the wait ran out. */
export async function preflight({ client, now = () => Date.now(), sleep = wait, maxWaitMs = 45 * 60_000, pollMs = 30_000, log = () => {} }) {
  const started = now();
  const health = await client.healthz();
  if (!health.ok) throw new HarnessError("harness is up but does not report ok", { code: "NOT_OK" });
  for (;;) {
    const roster = await client.accounts();
    const refresh = await client.refresh();
    const busy = isRefreshBusy({ refreshPhase: refresh.phase ?? roster.refreshPhase, accounts: roster.accounts });
    const guard = quarterWaitMs(now());
    if (!busy && guard === 0) return { quiet: true, waitedMs: now() - started, accounts: roster.accounts };
    if (now() - started + Math.max(guard, pollMs) > maxWaitMs) {
      return { quiet: false, waitedMs: now() - started, accounts: roster.accounts };
    }
    const pause = busy ? pollMs : guard;
    log(busy ? "a self-refresh is running; waiting" : "just after a quarter-hour mark; waiting");
    await sleep(pause);
  }
}
