/* Helpers that freeze small synthetic days into a scratch folder, for the render, seal and verify tests. */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDay } from "../../scripts/lib/render.mjs";
import { sealDay } from "../../scripts/lib/seal.mjs";
import { dayWindow } from "../../scripts/lib/time.mjs";

export const ZONE = "Europe/Berlin";
export const RULES = JSON.parse(readFileSync(new URL("../../config/rules.v1.json", import.meta.url), "utf8"));

export const ALLOW = [
  { key: "Alpha", label: "Alpha", fundedDate: "2026-10-01", order: 0 },
  { key: "Beta", label: "Beta", fundedDate: "2026-10-01", order: 1 },
  { key: "Late", label: "Late", fundedDate: "2026-10-25", order: 2 },
];

/* A close as capture produces it. `hours` is the offset from the start of the local day. */
export function close(window, ticket, hours, cents, extra = {}) {
  return {
    key: `${ticket}@${window.startSec + Math.round(hours * 3600)}`, ticket, symbol: "EURUSD", side: "long", cents, r: null,
    closeSec: window.startSec + Math.round(hours * 3600), openSec: window.startSec + Math.round(hours * 3600) - 900,
    selftest: false, source: "api", ...extra,
  };
}

export const capture = (closes, extra = {}) => ({
  usable: true, source: "both", closes, problems: [], witness: {}, currency: "EUR", fundingCents: 5_000_000,
  balanceCents: null, delta: { ok: null, gapCents: null }, ...extra,
});

export function scratch() {
  const root = mkdtempSync(join(tmpdir(), "maeh-days-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/* Render and seal one day. `perAccount` maps an account key to a list of [ticket, hours, cents]. */
export function freeze(root, date, perAccount, { kind = "nightly", gates = {}, captures = {}, nowSec } = {}) {
  const window = dayWindow(date, ZONE);
  const accounts = ALLOW.map((allow) => ({
    allow,
    capture: captures[allow.key] ?? (perAccount[allow.key] ? capture(perAccount[allow.key].map(([ticket, hours, cents]) => close(window, ticket, hours, cents))) : capture([])),
    gate: gates[allow.key] ?? null,
  }));
  const rendered = renderDay({ date, window, kind, accounts, rules: RULES });
  const sealed = sealDay({ root, date, rendered, kind, capturedAtSec: nowSec ?? window.endSec + 4000, zone: ZONE, window, rules: RULES });
  return { rendered, sealed, window };
}
