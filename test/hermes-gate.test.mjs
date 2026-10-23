import test from "node:test";
import assert from "node:assert/strict";
import { hermesWakes, hermesWouldRedact } from "./helpers/hermes.mjs";

test("the port of Hermes's wake gate: only a last line of {\"wakeAgent\": false} silences the agent", () => {
  assert.equal(hermesWakes('some text\n{"wakeAgent": false}\n'), false);
  assert.equal(hermesWakes('{"wakeAgent":false,"outcome":"noop"}'), false);
  assert.equal(hermesWakes('{"wakeAgent": true}'), true);
  assert.equal(hermesWakes('{"outcome":"noop"}'), true, "a missing flag wakes");
  assert.equal(hermesWakes(""), true, "no output wakes");
  assert.equal(hermesWakes("plain text only"), true);
  assert.equal(hermesWakes('{"wakeAgent": false}\nafter'), true, "the gate must be the LAST line");
  assert.equal(hermesWakes('{"wakeAgent": false}\n\n  \n'), false, "trailing blank lines are ignored");
  assert.equal(hermesWakes("[1,2]"), true);
});

test("the redactor check sees secret-named keys and long digests", () => {
  assert.equal(hermesWouldRedact('{"wakeAgent":false,"attention":[]}'), false);
  assert.equal(hermesWouldRedact('{"token":"x"}'), true);
  assert.equal(hermesWouldRedact(`digest ${"a".repeat(40)}`), true);
});
