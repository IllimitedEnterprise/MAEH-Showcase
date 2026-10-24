import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "../scripts/lib/pipeline.mjs";
import { scratch } from "./helpers/days.mjs";

/* The private state files (the last-run record and the balances the next night's check starts from) are written
 * through writeJsonAtomic. On Windows a rename can be refused for a moment while something else has the target
 * open; the first real night left its last-run record stale, so a refusal is now retried rather than lost. */

const refusal = (code) => Object.assign(new Error(`${code}: refused`), { code });
const residue = (dir) => readdirSync(dir).filter((name) => name.includes(".tmp-"));

test("a state file is written whole, then replaced whole, and leaves nothing behind", () => {
  const { root, cleanup } = scratch();
  try {
    const file = join(root, "state", "last-run.json");
    writeJsonAtomic(file, { exit: 0, outcome: "noop" });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { exit: 0, outcome: "noop" });
    writeJsonAtomic(file, { exit: 0, outcome: "frozen" });
    assert.equal(JSON.parse(readFileSync(file, "utf8")).outcome, "frozen");
    assert.deepEqual(residue(join(root, "state")), []);
  } finally { cleanup(); }
});

test("a rename the system refuses for a moment is tried again, with growing pauses, and then goes through", () => {
  const { root, cleanup } = scratch();
  try {
    const file = join(root, "last-run.json");
    writeFileSync(file, '{"old":true}\n');
    const waits = [];
    let refused = 0;
    const rename = (from, to) => {
      if (refused < 3) { refused += 1; throw refusal(["EPERM", "EBUSY", "EACCES"][refused - 1]); }
      renameSync(from, to);
    };
    writeJsonAtomic(file, { new: true }, { rename, wait: (ms) => waits.push(ms) });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { new: true });
    assert.deepEqual(waits, [40, 80, 160]);
    assert.deepEqual(residue(root), []);
  } finally { cleanup(); }
});

test("the real pause between tries really pauses (no injected wait)", () => {
  const { root, cleanup } = scratch();
  try {
    const file = join(root, "captures.json");
    let refused = false;
    const rename = (from, to) => {
      if (!refused) { refused = true; throw refusal("EBUSY"); }
      renameSync(from, to);
    };
    const started = process.hrtime.bigint();
    writeJsonAtomic(file, { ok: true }, { rename });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms >= 35, `it waited about 40 ms before the second try (${ms.toFixed(1)} ms)`);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ok: true });
  } finally { cleanup(); }
});

test("a rename that is refused every time gives up, raises the error, keeps the old file and removes the temporary one", () => {
  const { root, cleanup } = scratch();
  try {
    const file = join(root, "last-run.json");
    writeFileSync(file, '{"old":true}\n');
    const waits = [];
    assert.throws(() => writeJsonAtomic(file, { new: true }, { rename: () => { throw refusal("EPERM"); }, wait: (ms) => waits.push(ms) }), /EPERM/);
    assert.deepEqual(waits, [40, 80, 160, 320, 640], "five retries, then it stops");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { old: true }, "the old record is never half-replaced");
    assert.deepEqual(residue(root), []);
  } finally { cleanup(); }
});

test("an error that is not a passing one is raised at once, without waiting", () => {
  const { root, cleanup } = scratch();
  try {
    const file = join(root, "gone", "last-run.json");
    const waits = [];
    assert.throws(() => writeJsonAtomic(file, {}, { rename: () => { throw refusal("ENOSPC"); }, wait: (ms) => waits.push(ms) }), /ENOSPC/);
    assert.deepEqual(waits, []);
    assert.ok(!existsSync(file));
    assert.deepEqual(residue(join(root, "gone")), []);
  } finally { cleanup(); }
});
