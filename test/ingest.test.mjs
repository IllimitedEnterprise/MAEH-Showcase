import test from "node:test";
import assert from "node:assert/strict";
import { attachR, closeFromApi, closeFromLedger, closeKey, inWindow, mergeCloses, withResult } from "../scripts/lib/ingest.mjs";

const api = (ticket, at, netMoney, extra = {}) => ({
  ticket, symbol: "EURUSD", direction: "LONG", at, openedAt: at - 900, netMoney, r: null, selftest: false, ...extra,
});
const ledger = (ticket, closedAt, netProfit, extra = {}) => ({
  ticket, symbol: "EURUSD", type: 0, direction: "LONG", closedAt, openedAt: closedAt - 900, netProfit,
  comment: "TUdeadbeef", volume: 1, openPrice: 1.1, closePrice: 1.2, ...extra,
});

test("API rows are picked field by field and money becomes cents", () => {
  const close = closeFromApi({ ...api(101, 1_700_000_000, 12.34, { r: 0.5 }), model: "secret-model", stage: "IX-C", comment: "x" });
  assert.deepEqual(Object.keys(close).sort(),
    ["cents", "closeSec", "key", "openSec", "r", "selftest", "side", "source", "symbol", "ticket"]);
  assert.equal(close.cents, 1234);
  assert.equal(close.side, "long");
  assert.equal(close.key, "101@1700000000");
  assert.equal(close.r, 0.5);
});

test("ledger rows never carry the comment, prices or volume forward", () => {
  const close = closeFromLedger(ledger(7, 1_700_000_000, -3.21));
  assert.ok(!JSON.stringify(close).includes("TUdeadbeef"));
  assert.ok(!("openPrice" in close) && !("volume" in close) && !("comment" in close));
  assert.equal(close.cents, -321);
  assert.equal(close.r, null);
});

test("side comes from direction, then from the numeric or named order type", () => {
  assert.equal(closeFromApi(api(1, 5, 1, { direction: "SHORT" })).side, "short");
  assert.equal(closeFromLedger({ ...ledger(1, 5, 1), direction: null, type: 1 }).side, "short");
  assert.equal(closeFromLedger({ ...ledger(1, 5, 1), direction: null, type: 0 }).side, "long");
  assert.equal(closeFromApi(api(1, 5, 1, { direction: null, type: "ORDER_TYPE_SELL" })).side, "short");
  assert.equal(closeFromApi(api(1, 5, 1, { direction: null })).side, "unknown");
});

test("a row without a close instant is not a close; one without a result keeps null, not zero", () => {
  assert.equal(closeFromApi({ ticket: 1, netMoney: 5 }), null);
  assert.equal(closeFromLedger(null), null);
  assert.equal(closeFromApi(api(1, 5, null)).cents, null);
  assert.equal(withResult([closeFromApi(api(1, 5, null)), closeFromApi(api(2, 6, 0))]).length, 1);
});

test("identity is ticket@round(closedAt): a ticket closed in parts is several closes", () => {
  assert.equal(closeKey(5, 100.4), "5@100");
  const merged = mergeCloses({ apiRows: [api(5, 100, 1), api(5, 160, 2)] });
  assert.equal(merged.closes.length, 2);
});

test("merging: both sources agree, the API row wins and keeps R", () => {
  const merged = mergeCloses({
    apiRows: [api(1, 100, 10, { r: 1.2 }), api(2, 200, -5)],
    ledgerRows: [ledger(1, 100, 10), ledger(2, 200, -5)],
  });
  assert.equal(merged.closes.length, 2);
  assert.deepEqual(merged.witness, { both: 2, onlyApi: 0, onlyLedger: 0, compared: true });
  assert.equal(merged.closes.find((close) => close.ticket === 1).r, 1.2);
  assert.ok(merged.closes.every((close) => close.source === "both"));
});

test("merging: a close only the ledger has is kept and counted as attention", () => {
  const merged = mergeCloses({ apiRows: [api(1, 100, 10)], ledgerRows: [ledger(1, 100, 10), ledger(9, 300, 4)] });
  assert.equal(merged.closes.length, 2);
  assert.equal(merged.witness.onlyLedger, 1);
  assert.equal(merged.witness.onlyApi, 0);
});

test("merging: a close only the API has is a note, not a problem", () => {
  const merged = mergeCloses({ apiRows: [api(1, 100, 10), api(2, 150, 3)], ledgerRows: [ledger(1, 100, 10)] });
  assert.equal(merged.witness.onlyApi, 1);
});

test("a single source gives no witness comparison", () => {
  const merged = mergeCloses({ ledgerRows: [ledger(1, 100, 1)] });
  assert.equal(merged.witness.compared, false);
  assert.equal(merged.closes[0].source, "ledger");
});

test("anomalies: repeated rows, missing results and unknown sides are counted", () => {
  const merged = mergeCloses({
    apiRows: [api(1, 100, 10), api(1, 100, 10), api(2, 200, null), api(3, 300, 1, { direction: null })],
  });
  assert.equal(merged.anomalies.duplicateRows, 1);
  assert.equal(merged.anomalies.nullNet, 1);
  assert.equal(merged.anomalies.unknownSide, 1);
  assert.equal(merged.closes.length, 3);
});

test("R is the close's net result over what the order risked, joined by ticket", () => {
  const rows = attachR([ledger(7, 100, 30), ledger(8, 200, -15), ledger(9, 300, 5)], [
    { ticket: 7, clientRef: "TUa", riskAmount: 20 },
    { ticket: 8, clientRef: "TUb", riskAmount: 10 },
  ]);
  assert.deepEqual(rows.map((row) => row.r), [1.5, -1.5, undefined]);
  assert.equal(closeFromLedger(rows[0]).r, 1.5);
  assert.equal(closeFromLedger(rows[2]).r, null, "no linked intent: R stays null, never a guess");
});

test("R: a broker comment that contains the intent's reference links a close the ticket does not", () => {
  const [row] = attachR([{ ...ledger(999, 100, 12), comment: "from TUdeadbeef-ext" }], [{ ticket: 1, clientRef: "TUdeadbeef", riskAmount: 8 }]);
  assert.equal(row.r, 1.5);
});

test("R: an intent with no positive risk, or a close with no result, is not given an R", () => {
  const rows = attachR([ledger(1, 100, 10), ledger(2, 200, null), ledger(3, 300, 4)], [
    { ticket: 1, clientRef: "A", riskAmount: 0 }, { ticket: 2, clientRef: "B", riskAmount: 5 }, { ticket: 3, clientRef: "C", riskAmount: null },
  ]);
  assert.deepEqual(rows.map((row) => row.r), [undefined, undefined, undefined]);
  assert.deepEqual(attachR(undefined, undefined), []);
});

test("R is rounded to three decimals like the harness's own", () => {
  assert.equal(attachR([ledger(1, 100, 10)], [{ ticket: 1, riskAmount: 3 }])[0].r, 3.333);
});

test("window filter is half-open", () => {
  const window = { startSec: 100, endSec: 200 };
  const closes = [99, 100, 150, 199, 200].map((sec) => closeFromApi(api(sec, sec, 1)));
  assert.deepEqual(inWindow(closes, window).map((close) => close.closeSec), [100, 150, 199]);
});
