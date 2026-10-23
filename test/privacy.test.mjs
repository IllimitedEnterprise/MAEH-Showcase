import test from "node:test";
import assert from "node:assert/strict";
import { scanFile, scanFiles } from "../scripts/lib/privacy.mjs";

const rules = (file, content) => scanFile(file, content).map((finding) => `${finding.rule}:${finding.path}`);

test("a clean summary and a clean markdown page produce no findings", () => {
  const json = JSON.stringify({ schema: 1, date: "2026-10-22", key: "M9-B-CHERRY", net: 1518.5, pairs: [{ symbol: "EURUSD", n: 3, net: 20 }] });
  assert.deepEqual(scanFile("results/x/summary.json", json), []);
  assert.deepEqual(scanFile("results/x/README.md", "# 2026-10-22\n\nDesk net **+1518.50** over 94 closes.\n\n| Account | Net |\n|---|---:|\n| M9-B-CHERRY | +20.00 |\n"), []);
});

test("forbidden field names are findings at any depth, in any case", () => {
  assert.deepEqual(rules("a.json", '{"ticket":1}'), ["key:$.ticket"]);
  assert.deepEqual(rules("a.json", '{"a":{"Login":"1"}}'), ["key:$.a.Login"]);
  assert.deepEqual(rules("a.json", '{"list":[{"comment":"x"}]}'), ["key:$.list[0].comment"]);
  for (const key of ["server", "model", "stage", "timeframe", "volume", "openPrice", "equity", "floatingProfit", "terminalPath", "accountId"]) {
    assert.ok(rules("a.json", JSON.stringify({ [key]: 1 })).some((entry) => entry.startsWith("key:")), key);
  }
});

test("address, path, URL and secret shapes are findings", () => {
  const cases = {
    uuid: "5d4a3309-1f2e-4b6a-8c3d-0123456789ab",
    ip: "127.0.0.1",
    host: "localhost",
    port: "port 8790",
    drive: "C:\\Users\\t\\x",
    unix: "see /Users/t/file",
    email: "me@example.com",
    url: "https://example.com/x",
    broker: "VantageMarkets-Demo",
    /* Secret-shaped samples are assembled at run time, so no file or commit of this repository
     * ever contains a string a secret scanner would rightly flag. */
    pwfield: `${"pass"}${"word"}: "hunter2hunter2"`,
    bearer: `${"Bear"}${"er"} abcdefghijklmnop`,
    skkey: `${"s"}${"k-"}abcdefghijklmnopqrstuvwxyz`,
    gh: `${"gh"}${"p_"}abcdefghijklmnopqrstuvwxyz0123`,
    pem: `${"-----BEGIN "}${"PRIVATE KEY-----"}`,
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.ok(scanFile("results/x/README.md", `note: ${text}`).length > 0, `${name} should be flagged`);
  }
});

test("an instant is allowed only where a manifest needs one", () => {
  const manifest = JSON.stringify({ capturedAt: "2026-10-22T23:05:00Z", window: { startUtc: "2026-10-21T22:00:00Z", endUtc: "2026-10-22T22:00:00Z" } });
  assert.deepEqual(scanFile("results/x/day.json", manifest), []);
  assert.deepEqual(rules("results/x/summary.json", JSON.stringify({ note: "2026-10-22T12:30:00Z" })), ["time:$.note"]);
  assert.ok(rules("results/x/README.md", "closed at 2026-10-22 12:30").length > 0);
  assert.deepEqual(scanFile("results/x/README.md", "frozen for 2026-10-22"), []);
});

test("long digit runs are flagged, hashes and file sizes are not", () => {
  assert.ok(rules("a.json", '{"n":12345678}').length > 0);
  assert.ok(rules("a.json", '{"s":"order 1234567"}').length > 0);
  const hash = "0123456789abcdef".repeat(4);
  assert.deepEqual(scanFile("a.json", JSON.stringify({ sha256: hash })), []);
  assert.deepEqual(scanFile("a.json", JSON.stringify({ files: { "README.md": { sha256: hash, bytes: 2_500_000 } } })), []);
});

test("bytes outside printable ASCII, and carriage returns, are findings", () => {
  assert.ok(rules("a.md", "caf\u00e9").includes("bytes:$"));
  assert.ok(rules("a.md", "zero\u200bwidth").includes("bytes:$"));
  assert.ok(rules("a.md", "line\r\nbreak").includes("bytes:$"));
  assert.deepEqual(scanFile("a.md", "plain\n\ttabbed\n"), []);
});

test("invalid JSON in a .json file is itself a finding", () => {
  assert.deepEqual(rules("a.json", "{nope"), ["json:$"]);
});

test("scanFiles accepts a Map or an object and keeps the file name on each finding", () => {
  const found = scanFiles(new Map([["a.json", '{"ticket":1}'], ["b.json", "{}"]]));
  assert.equal(found.length, 1);
  assert.equal(found[0].file, "a.json");
  assert.equal(scanFiles({ "c.json": '{"login":1}' })[0].file, "c.json");
});
