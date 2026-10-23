/* A stand-in for the MAEH harness's HTTP API, for tests. It answers the four read-only routes,
 * and it deliberately includes the fields the real /accounts carries and this project must
 * never keep (login, server, terminalPath), so a leak shows up as a failing test. */

import { createServer } from "node:http";

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

export const LEAKY_LOGIN = "55501234";
export const LEAKY_SERVER = "SomeBroker-Demo";
export const LEAKY_PATH = "C:\\secret\\terminal64.exe";

export function profile(id, label, extra = {}) {
  return {
    id, label, login: LEAKY_LOGIN, server: LEAKY_SERVER, active: true, verified: true, terminalPath: LEAKY_PATH,
    effectiveDiscoverySpec: { stage: "IX-C", timeframes: ["M15"] },
    runtime: { state: "healthy", refreshing: false, url: "http://127.0.0.1:18880", port: 18880 },
    ...extra,
  };
}

/* scenario.progress[accountId] is a payload, a function (callNumber) => payload | response
 * descriptor, or an array of those used in turn (the last one repeats). A descriptor is
 * { status, code } for an error, { delayMs, body } to stall, or { raw } for a non-JSON body. */
export async function startFakeHarness(scenario = {}) {
  const calls = [];
  const counters = new Map();
  const phases = Array.isArray(scenario.refreshPhase) ? [...scenario.refreshPhase] : [scenario.refreshPhase ?? "idle"];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (request.method !== "GET") return json(response, 404, { error: { code: "NOT_FOUND" } });

    if (url.pathname === "/healthz") return json(response, 200, { ok: scenario.health !== false, service: "fake", version: "0", phase: "x", mt5: "unchecked" });

    if (url.pathname === "/api/v1/accounts") {
      const phase = phases.length > 1 ? phases[0] : phases[0];
      return json(response, 200, {
        profiles: scenario.accounts ?? [profile("acc-1", "Alpha")],
        selectedProfileId: "acc-1", running: true, locked: false,
        refresh: { enabled: true, phase },
      });
    }

    if (url.pathname === "/api/v1/maintenance/refresh") {
      const phase = phases.length > 1 ? phases.shift() : phases[0];
      return json(response, 200, { enabled: true, phase });
    }

    if (url.pathname === "/api/v1/account/progress") {
      const accountId = url.searchParams.get("accountId") ?? "";
      const count = (counters.get(accountId) ?? 0) + 1;
      counters.set(accountId, count);
      let entry = scenario.progress?.[accountId];
      if (Array.isArray(entry)) entry = entry[Math.min(count - 1, entry.length - 1)];
      if (typeof entry === "function") entry = entry(count);
      if (entry === undefined) return json(response, 409, { error: { code: "NO_ACTIVE_ACCOUNT_RUNTIME", message: `no runtime for ${LEAKY_LOGIN}` } });
      if (entry.status) return json(response, entry.status, { error: { code: entry.code ?? "ERR", message: `internal detail ${LEAKY_PATH}` } });
      if (entry.raw !== undefined) { response.writeHead(200, { "content-type": "text/plain" }); return response.end(entry.raw); }
      if (entry.delayMs) await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
      return json(response, 200, entry.body ?? entry);
    }

    return json(response, 404, { error: { code: "NOT_FOUND" } });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

/* A progress payload shaped like the real one, built from simple trade descriptions. */
export function progressPayload({ trades = [], balance = 50000, deposits = 50000, truncated = false, currency = "EUR", fromSec = 0 } = {}) {
  return {
    schemaVersion: 1,
    checkedAt: "2026-10-23T00:05:00.000Z",
    accountCurrency: currency,
    account: { currency, balance, equity: balance + 12.5, floatingProfit: 12.5, deposits, fundingRows: 1, realized: balance - deposits, asOf: "2026-10-23T00:05:00.000Z" },
    range: { requestedDays: 2, from: fromSec, to: fromSec + 3 * 86400 },
    coverage: { brokerRows: trades.length, chartedTrades: trades.length, truncated, journal: { closes: 0, matched: 0, missing: 0 }, balance: { reconciled: null, gap: null } },
    metrics: {}, statistics: {},
    trades: trades.map((trade) => ({
      ticket: trade.ticket, symbol: trade.symbol ?? "EURUSD", direction: trade.direction ?? "LONG", type: "BUY", volume: 1,
      entryPrice: 1.1, closePrice: 1.2, at: trade.at, atIso: new Date(trade.at * 1000).toISOString(),
      openedAt: trade.openedAt ?? trade.at - 900, netMoney: trade.net, r: trade.r ?? null,
      model: "SECRET-MODEL", stage: "IX-C", timeframe: "M15", selftest: false, persisted: false,
    })),
  };
}
