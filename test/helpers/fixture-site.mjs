/* A whole dashboard root built from small synthetic days, for the UI states the real season does not
 * have yet: no days at all, a single day, a gap, a partial or unverified day, a quiet day, and the
 * 25-hour day when the clocks go back. The frozen days are made by the project's own render and seal
 * code, so they are valid in every way the real ones are; the site itself is copied from this checkout. */

import { cpSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext, rebuildDerived } from "../../scripts/lib/pipeline.mjs";
import { ALLOW, capture, close, freeze, ZONE } from "./days.mjs";
import { dayWindow } from "../../scripts/lib/time.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

export { capture, close, dayWindow };

/* [ticket, hours into the day, cents] for each close, in a spread of sizes and hours. */
export const trades = (...cents) => cents.map((c, i) => [100 + i, 1 + (i % 20) * 1.1, c]);

/* The states the real season does not have, as the arguments for makeFixtureSite. */
export const SEASONS = {
  empty: { days: [] },
  one: { seasonStart: "2026-10-24", days: [{ date: "2026-10-24", perAccount: { Alpha: trades(4000, -1500, 2500, 900), Beta: trades(-800, -300, 1200) } }] },
  /* the clocks go forward: a 23-hour day */
  spring: { seasonStart: "2027-03-28", days: [{ date: "2027-03-28", perAccount: { Alpha: trades(1500, 900, -400, 700) } }] },
  mixed: {
    seasonStart: "2026-10-19",
    days: [
      { date: "2026-10-19", perAccount: { Alpha: trades(2200, 1800, -600, 900), Beta: trades(300, -400, 500) } },
      { date: "2026-10-20", perAccount: { Alpha: trades(-1200, -800, 400), Beta: trades(1500, 900, 700, -200) } },
      /* 2026-10-21 is never frozen: a gap */
      { date: "2026-10-22", perAccount: { Alpha: trades(1000, 800, 600, -200), Beta: trades(-500, -600, -400) }, options: { gates: { Alpha: { ok: false, gapCents: 47600 } } } },
      { date: "2026-10-23", perAccount: { Alpha: trades(700, 300, -900), Beta: trades(1200, 600, 300, 400) }, options: { captures: { Beta: capture([], { usable: true, problems: [{ code: "ledger-torn", severity: "partial" }] }) } } },
      { date: "2026-10-24", perAccount: {} },
      /* the clocks go back: 25 hours, and the 02:00 hour happens twice */
      { date: "2026-10-25", perAccount: { Alpha: [[1, 1.5, 2500], [2, 2.5, -700], [3, 3.5, 1900], [4, 3.8, 800], [5, 9, -300], [6, 15, 1400]], Beta: [[7, 2.6, 900], [8, 3.6, 600], [9, 12, -400]], Late: [[10, 14, 500], [11, 16, 300], [12, 19, 700]] } },
      { date: "2026-10-26", perAccount: { Alpha: trades(900, 1100, 700, -200), Beta: trades(-300, 500, 400), Late: trades(600, 800, 400) } },
      { date: "2026-10-27", perAccount: { Alpha: [[1, 10, 500]] } },
    ],
  },
};

/* days: [{ date, perAccount: { Alpha: [[ticket, hoursFromMidnight, cents], ...] }, options }] */
export function makeFixtureSite({ seasonStart = "2026-10-19", days = [] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "maeh-fixture-"));
  const root = join(base, "root");
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "season.json"), `${JSON.stringify({ schema: 1, zone: ZONE, seasonStart, rules: "v1", settleMinutes: 30, quietWaitMinutes: 45, healthWakeDays: [] }, null, 2)}\n`);
  writeFileSync(join(root, "config", "accounts.json"), `${JSON.stringify({ schema: 1, accounts: ALLOW.map(({ key, label, fundedDate }) => ({ label, key, fundedDate })) }, null, 2)}\n`);
  copyFileSync(join(REPO, "config", "rules.v1.json"), join(root, "config", "rules.v1.json"));
  cpSync(join(REPO, "site"), join(root, "site"), { recursive: true });
  mkdirSync(join(root, "results"), { recursive: true });
  mkdirSync(join(root, "stars"), { recursive: true });
  for (const day of days) freeze(root, day.date, day.perAccount, day.options ?? {});
  const env = { ...process.env, MAEH_SHOWCASE_STATE: join(base, "state") };
  rebuildDerived(loadContext(root, env));
  return { root, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
