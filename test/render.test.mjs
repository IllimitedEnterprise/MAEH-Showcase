import test from "node:test";
import assert from "node:assert/strict";
import { renderDay } from "../scripts/lib/render.mjs";
import { dayWindow } from "../scripts/lib/time.mjs";
import { ALLOW, RULES, capture, close } from "./helpers/days.mjs";

const DATE = "2026-10-22";
const window = dayWindow(DATE, "Europe/Berlin");

function render(perAccount, { date = DATE, kind = "nightly", gates = {}, captures = {} } = {}) {
  const win = dayWindow(date, "Europe/Berlin");
  const accounts = ALLOW.map((allow) => ({
    allow,
    capture: captures[allow.key] ?? capture((perAccount[allow.key] ?? []).map(([ticket, hours, cents]) => close(win, ticket, hours, cents))),
    gate: gates[allow.key] ?? null,
  }));
  return renderDay({ date, window: win, kind, accounts, rules: RULES });
}

const json = (rendered, path) => JSON.parse(rendered.files.get(path));

test("statuses: ok with closes, quiet without, prefunding before the funding date", () => {
  const rendered = render({ Alpha: [[1, 1, 10_000], [2, 2, 20_000], [3, 3, -5_000], [4, 4, 30_000]] });
  assert.deepEqual(rendered.accountStatuses, { Alpha: "ok", Beta: "quiet", Late: "prefunding" });
  assert.equal(rendered.status, "complete");
  const keys = [...rendered.files.keys()];
  assert.ok(keys.some((path) => path.startsWith("accounts/Alpha/")));
  assert.ok(keys.some((path) => path.startsWith("accounts/Beta/")));
  assert.ok(!keys.some((path) => path.startsWith("accounts/Late/")), "an unfunded account has no folder");
});

test("an account's summary carries the harness-identical figures", () => {
  const summary = json(render({ Alpha: [[1, 1, 10_000], [2, 2, 20_000], [3, 3, -5_000], [4, 4, 30_000]] }), "accounts/Alpha/summary.json");
  assert.equal(summary.n, 4);
  assert.deepEqual([summary.wins, summary.losses, summary.breakevens], [3, 1, 0]);
  assert.equal(summary.net, 550);
  assert.equal(summary.grossWin, 600);
  assert.equal(summary.grossLoss, 50);
  assert.equal(summary.profitFactor, 12);
  assert.equal(summary.winRatePct, 75);
  assert.equal(summary.retPct, 1.1);
  assert.equal(summary.funding, 50000);
  assert.equal(summary.maxDrawdown, 50);
  assert.deepEqual(summary.pairs, [{ symbol: "EURUSD", n: 4, net: 550 }]);
  assert.equal(summary.source, "both");
});

test("trades keep close order and carry no times; the CSV matches", () => {
  const rendered = render({ Alpha: [[7, 3, -500], [8, 1, 1_000], [9, 2, 250]] });
  const trades = json(rendered, "accounts/Alpha/trades.json");
  assert.deepEqual(trades.trades.map((trade) => [trade.i, trade.net]), [[1, 10], [2, 2.5], [3, -5]]);
  assert.deepEqual(Object.keys(trades.trades[0]), ["i", "symbol", "side", "net", "r"]);
  assert.equal(rendered.files.get("accounts/Alpha/trades.csv"), "i,symbol,side,net,r\n1,EURUSD,long,10.00,\n2,EURUSD,long,2.50,\n3,EURUSD,long,-5.00,\n");
});

test("no ticket, comment or timestamp from a close reaches a published file", () => {
  const win = dayWindow(DATE, "Europe/Berlin");
  const secret = close(win, 987654321, 5, 12_345, { key: "987654321@999", comment: "TUdeadbeefcafe", model: "SECRET-MODEL" });
  const rendered = render({}, { captures: { Alpha: capture([secret, close(win, 5, 6, 100), close(win, 6, 7, 200)]) } });
  const all = [...rendered.files.values()].join("\n");
  for (const forbidden of ["987654321", "TUdeadbeefcafe", "SECRET-MODEL", String(secret.closeSec), "ticket"]) assert.ok(!all.includes(forbidden), `${forbidden} leaked`);
});

test("partial: a flagged problem says so in plain words and makes the day partial", () => {
  const win = dayWindow(DATE, "Europe/Berlin");
  const rendered = render({}, { captures: { Alpha: capture([close(win, 1, 1, 100)], { problems: [{ code: "null-result", severity: "partial", n: 2 }] }) } });
  const summary = json(rendered, "accounts/Alpha/summary.json");
  assert.equal(summary.status, "partial");
  assert.deepEqual(summary.reasons, ["2 close(s) have no recorded result and are not counted"]);
  assert.equal(rendered.status, "partial");
  assert.match(rendered.files.get("README.md"), /Status: \*\*partial\*\*/);
});

test("an unusable capture is published as partial with no figures, never as a quiet day", () => {
  const rendered = render({}, { captures: { Alpha: capture([], { usable: false, source: null, problems: [{ code: "no-complete-source", severity: "blocking" }] }) } });
  const summary = json(rendered, "accounts/Alpha/summary.json");
  assert.deepEqual([summary.status, summary.source, summary.n], ["partial", "none", 0]);
  assert.deepEqual(summary.reasons, ["no complete source was available for this day"]);
  assert.ok(rendered.files.get("accounts/Alpha/summary.md").includes("Status: **partial** (source: none)"));
});

test("unverified: a failed backfill gate is badged with the size of the gap", () => {
  const win = dayWindow(DATE, "Europe/Berlin");
  const rendered = render({}, {
    kind: "backfilled",
    captures: { Alpha: capture([close(win, 1, 1, 100), close(win, 2, 2, 100), close(win, 3, 3, 100)], { source: "ledger" }) },
    gates: { Alpha: { ok: false, gapCents: 47_607 } },
  });
  const summary = json(rendered, "accounts/Alpha/summary.json");
  assert.equal(summary.status, "unverified");
  assert.match(summary.reasons[0], /differ from the balance by \+476\.07/);
  assert.deepEqual(summary.chain, { ok: false, gap: 476.07 });
  assert.equal(rendered.status, "partial", "an unverified account stops the day being called complete");
  assert.equal(rendered.stars.crown, null, "an unverified account cannot be crowned");
  assert.deepEqual(rendered.stars.withheld, [{ key: "Alpha", reason: "partial or unverified, so not eligible" }]);
});

test("a live-read outage is explained on a nightly day and not repeated on every backfilled one", () => {
  const win = dayWindow(DATE, "Europe/Berlin");
  const problems = [{ code: "api-unavailable", severity: "note", detail: "TERMINAL_OFFLINE" }];
  const nightly = render({}, { captures: { Alpha: capture([close(win, 1, 1, 100)], { problems, source: "ledger" }) } });
  assert.deepEqual(json(nightly, "accounts/Alpha/summary.json").reasons, ["the live read was unavailable (TERMINAL_OFFLINE)"]);
  const backfilled = render({}, { kind: "backfilled", captures: { Alpha: capture([close(win, 1, 1, 100)], { problems, source: "ledger" }) } });
  assert.deepEqual(json(backfilled, "accounts/Alpha/summary.json").reasons, []);
});

test("the Star of the day is named in the README and sealed in stars.json", () => {
  const rendered = render({ Alpha: [[1, 1, 40_000], [2, 2, 30_000], [3, 3, 50_000], [4, 4, -10_000]], Beta: [[5, 1, 100], [6, 2, 100], [7, 3, 100]] });
  assert.equal(rendered.stars.crown.key, "Alpha");
  assert.match(rendered.files.get("README.md"), /Star of the day: \*\*Alpha\*\*/);
  const rows = json(rendered, "stars.json").rows;
  assert.deepEqual(rows.map((row) => [row.key, row.rank]), [["Alpha", 1], ["Beta", 2]]);
  assert.equal(json(rendered, "stars.json").rules, "v1");
});

test("no crown when nobody has three closes or nobody finished positive", () => {
  const none = render({ Alpha: [[1, 1, 100], [2, 2, 100]] });
  assert.equal(none.stars.crown, null);
  assert.match(none.files.get("README.md"), /No Star of the day/);
  const losing = render({ Alpha: [[1, 1, -100], [2, 2, -100], [3, 3, -100]] });
  assert.equal(losing.stars.crown, null);
});

test("a breakeven-only day is a day with closes, not a quiet one, and earns no crown", () => {
  const rendered = render({ Alpha: [[1, 1, 0], [2, 2, 0], [3, 3, 0]] });
  assert.equal(rendered.accountStatuses.Alpha, "ok");
  assert.equal(rendered.stars.crown, null);
  assert.equal(json(rendered, "accounts/Alpha/summary.json").breakevens, 3);
});

test("the desk adds the accounts up, and its hours add up to its closes", () => {
  const rendered = render({ Alpha: [[1, 1, 10_000], [2, 2, -2_000]], Beta: [[3, 5, 500]] });
  const desk = json(rendered, "desk.json");
  assert.equal(desk.n, 3);
  assert.equal(desk.net, 85);
  assert.deepEqual(desk.best, { key: "Alpha", net: 80 });
  assert.deepEqual(desk.worst, { key: "Beta", net: 5 });
  assert.deepEqual(desk.accounts, { ok: 2, quiet: 0, partial: 0, unverified: 0, prefunding: 1 });
  const buckets = desk.hours.buckets.reduce((total, bucket) => total + bucket.n, 0);
  assert.equal(buckets + desk.hours.earlier + desk.hours.unknown, desk.hours.total);
  assert.equal(desk.hours.total, 3);
});

test("the 25-hour day has 25 hour buckets everywhere", () => {
  const rendered = render({ Alpha: [[1, 3, 100]] }, { date: "2026-10-25" });
  assert.equal(json(rendered, "accounts/Alpha/hours.json").buckets.length, 25);
  assert.equal(json(rendered, "desk.json").hours.buckets.length, 25);
});

test("rendering is deterministic: the same inputs give the same bytes", () => {
  const inputs = { Alpha: [[1, 1, 10_000], [2, 2, -2_000], [3, 3, 700]], Beta: [[4, 1, 5]] };
  const first = render(inputs);
  const second = render(inputs);
  assert.deepEqual([...first.files.entries()], [...second.files.entries()]);
  assert.deepEqual([...first.files.keys()], [...first.files.keys()].sort());
});

test("every rendered file is printable ASCII with LF endings", () => {
  const rendered = render({ Alpha: [[1, 1, 10_000], [2, 2, -2_000], [3, 3, 700]] });
  for (const [path, text] of rendered.files) {
    assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(text), `${path} has non-ASCII or control characters`);
    assert.ok(text.endsWith("\n"), `${path} should end with a newline`);
  }
});

test("a close with a missing result is not counted, and an unknown symbol does not break the schema", () => {
  const win = dayWindow(DATE, "Europe/Berlin");
  const noSymbol = close(win, 3, 3, 100, { symbol: null });
  const rendered = render({}, { captures: { Alpha: capture([close(win, 1, 1, 100), close(win, 2, 2, null), noSymbol]) } });
  const summary = json(rendered, "accounts/Alpha/summary.json");
  assert.equal(summary.n, 2);
  assert.deepEqual(summary.pairs.map((pair) => pair.symbol).sort(), ["EURUSD", "UNKNOWN"]);
  assert.equal(json(rendered, "accounts/Alpha/trades.json").trades[1].symbol, null);
});
