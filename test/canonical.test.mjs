import test from "node:test";
import assert from "node:assert/strict";
import { canonical, fromCents, sha256, stringify, toCents } from "../scripts/lib/canonical.mjs";

test("stringify is pretty, LF-terminated and keeps the order objects were built in", () => {
  const text = stringify({ b: 1, a: [1, 2], c: { z: true, y: null } });
  assert.equal(text, '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ],\n  "c": {\n    "z": true,\n    "y": null\n  }\n}\n');
  assert.ok(!text.includes("\r"));
});

test("stringify refuses values that would not survive a round trip", () => {
  assert.throws(() => stringify({ a: NaN }), TypeError);
  assert.throws(() => stringify({ a: Infinity }), TypeError);
  assert.throws(() => stringify({ a: undefined }), TypeError);
  assert.throws(() => stringify({ a: () => 1 }), TypeError);
  assert.throws(() => stringify({ a: 10n }), TypeError);
});

test("negative zero is written as zero", () => {
  assert.equal(JSON.parse(stringify({ a: -0 })).a, 0);
  assert.ok(!stringify({ a: -0 }).includes("-0"));
});

test("canonical sorts keys at every depth and is compact", () => {
  assert.equal(canonical({ b: 1, a: { d: [{ y: 1, x: 2 }], c: 0 } }), '{"a":{"c":0,"d":[{"x":2,"y":1}]},"b":1}');
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
});

test("sha256 matches the known vector", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(Buffer.from("abc")), sha256("abc"));
});

test("cents conversion does not carry float noise", () => {
  assert.equal(toCents(1518.5), 151850);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(-0.07), -7);
  assert.equal(fromCents(151850), 1518.5);
  let sum = 0;
  for (const value of [0.1, 0.2, 0.3, 0.4]) sum += toCents(value);
  assert.equal(fromCents(sum), 1);
});
