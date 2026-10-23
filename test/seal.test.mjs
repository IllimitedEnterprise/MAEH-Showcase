import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../scripts/lib/canonical.mjs";
import { renderDay } from "../scripts/lib/render.mjs";
import { SealError, cleanSealing, dayPath, sealDay } from "../scripts/lib/seal.mjs";
import { dayWindow } from "../scripts/lib/time.mjs";
import { errorsOf, formatFinding, listFrozen, verifyRoot } from "../scripts/lib/verify.mjs";
import { ALLOW, RULES, ZONE, capture, close, freeze, scratch } from "./helpers/days.mjs";

const rulesFor = (version) => (version === "v1" ? RULES : null);
const verify = (root) => verifyRoot(root, { rulesFor });
const errors = (root) => errorsOf(verify(root).findings).map(formatFinding);

const GOOD = { Alpha: [[1, 1, 10_000], [2, 2, 20_000], [3, 3, -5_000], [4, 4, 30_000]], Beta: [[5, 1, 100], [6, 2, 100], [7, 3, 100]] };

function season(root) {
  freeze(root, "2026-10-20", GOOD);
  freeze(root, "2026-10-21", GOOD);
  freeze(root, "2026-10-22", GOOD);
}

const read = (root, date, path) => readFileSync(join(dayPath(root, date), path), "utf8");
const write = (root, date, path, text) => writeFileSync(join(dayPath(root, date), path), text, "utf8");

test("a sealed day lands in results/YYYY/MM/DATE with a manifest that lists every other file", () => {
  const { root, cleanup } = scratch();
  try {
    const { sealed } = freeze(root, "2026-10-22", GOOD);
    assert.equal(sealed.dir, dayPath(root, "2026-10-22"));
    assert.ok(sealed.dir.replaceAll("\\", "/").endsWith("results/2026/10/2026-10-22"));
    const manifest = JSON.parse(read(root, "2026-10-22", "day.json"));
    assert.deepEqual([manifest.seq, manifest.prev, manifest.rules, manifest.zone, manifest.kind], [1, null, "v1", ZONE, "nightly"]);
    assert.ok("README.md" in manifest.files && "desk.json" in manifest.files && "stars.json" in manifest.files);
    assert.ok(!("day.json" in manifest.files));
    assert.deepEqual(manifest.accounts, { Alpha: "ok", Beta: "ok", Late: "prefunding" });
    assert.equal(manifest.window.hours, 24);
    assert.deepEqual(errors(root), []);
  } finally { cleanup(); }
});

test("days chain by sequence: each manifest holds the hash of the one before", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    const days = listFrozen(root);
    assert.deepEqual(days.map((day) => day.seq), [1, 2, 3]);
    assert.equal(days[1].manifest.prev.sha256, sha256(days[0].text));
    assert.equal(days[2].manifest.prev.sha256, sha256(days[1].text));
    assert.deepEqual(days[2].manifest.prev, { seq: 2, date: "2026-10-21", sha256: sha256(days[1].text) });
    assert.deepEqual(errors(root), []);
  } finally { cleanup(); }
});

test("a late backfill takes the next sequence number and the chain still holds", () => {
  const { root, cleanup } = scratch();
  try {
    freeze(root, "2026-10-22", GOOD);
    const { sealed } = freeze(root, "2026-10-20", GOOD, { kind: "backfilled" });
    assert.equal(sealed.seq, 2);
    assert.equal(sealed.manifest.prev.date, "2026-10-22");
    assert.deepEqual(errors(root), []);
  } finally { cleanup(); }
});

test("a frozen day is never overwritten", () => {
  const { root, cleanup } = scratch();
  try {
    freeze(root, "2026-10-22", GOOD);
    const before = read(root, "2026-10-22", "day.json");
    assert.throws(() => freeze(root, "2026-10-22", { Alpha: [[9, 1, 999_999]] }), (error) => error instanceof SealError && error.code === "ALREADY_FROZEN");
    assert.equal(read(root, "2026-10-22", "day.json"), before);
    assert.deepEqual(readdirSync(join(root, "results")).filter((entry) => entry.startsWith(".sealing-")), []);
  } finally { cleanup(); }
});

test("a file that fails the privacy scan stops the seal before anything is written", () => {
  const { root, cleanup } = scratch();
  try {
    const window = dayWindow("2026-10-22", ZONE);
    const accounts = ALLOW.map((allow) => ({ allow, capture: capture([close(window, 1, 1, 100)]), gate: null }));
    const rendered = renderDay({ date: "2026-10-22", window, kind: "nightly", accounts, rules: RULES });
    rendered.files.set("accounts/Alpha/extra.json", '{"ticket": 1}\n');
    assert.throws(() => sealDay({ root, date: "2026-10-22", rendered, kind: "nightly", capturedAtSec: window.endSec + 10, zone: ZONE, window, rules: RULES }),
      (error) => error.code === "PRIVACY");
    assert.ok(!existsSync(dayPath(root, "2026-10-22")));
    assert.ok(!existsSync(join(root, "results")) || readdirSync(join(root, "results")).length === 0);
  } finally { cleanup(); }
});

test("leftovers of a run that died mid-write are cleaned, and flagged until then", () => {
  const { root, cleanup } = scratch();
  try {
    freeze(root, "2026-10-22", GOOD);
    mkdirSync(join(root, "results", ".sealing-2026-10-23-4242"), { recursive: true });
    assert.ok(errors(root).some((line) => line.includes("a half-written day was left behind")));
    assert.deepEqual(cleanSealing(root), [".sealing-2026-10-23-4242"]);
    assert.deepEqual(errors(root), []);
  } finally { cleanup(); }
});

test("tamper: one flipped byte in a day's trades names the file", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    const path = "accounts/Alpha/trades.json";
    write(root, "2026-10-21", path, read(root, "2026-10-21", path).replace('"net": 100', '"net": 101'));
    const found = errors(root);
    assert.ok(found.some((line) => line.includes("2026-10-21") && line.includes(path) && line.includes("SHA-256")), found.join("\n"));
  } finally { cleanup(); }
});

test("tamper: editing a manifest breaks the next day's chain link", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    write(root, "2026-10-21", "day.json", read(root, "2026-10-21", "day.json").replace('"status": "complete"', '"status": "partial"'));
    const found = errors(root);
    assert.ok(found.some((line) => line.includes("2026-10-22") && line.includes("chain link does not match the previous day")), found.join("\n"));
  } finally { cleanup(); }
});

test("tamper: a consistent rewrite of a day's data AND its manifest still breaks the chain after it", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    const summaryPath = "accounts/Alpha/summary.json";
    const edited = read(root, "2026-10-21", summaryPath).replace('"net": 550', '"net": 9999');
    write(root, "2026-10-21", summaryPath, edited);
    const manifest = JSON.parse(read(root, "2026-10-21", "day.json"));
    manifest.files[summaryPath] = { sha256: sha256(edited), bytes: Buffer.byteLength(edited) };
    write(root, "2026-10-21", "day.json", `${JSON.stringify(manifest, null, 2)}\n`);
    const found = errors(root);
    assert.ok(found.some((line) => line.includes("net does not match the trades")), "re-derivation from trades catches the figure");
    assert.ok(found.some((line) => line.includes("2026-10-22") && line.includes("chain link")), "the next day's link catches the manifest");
  } finally { cleanup(); }
});

test("tamper: deleting a day leaves a hole in the sequence", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    rmSync(dayPath(root, "2026-10-21"), { recursive: true, force: true });
    const found = errors(root);
    assert.ok(found.some((line) => line.includes("2026-10-22") && line.includes("sequence number 3 where 2 was expected")), found.join("\n"));
  } finally { cleanup(); }
});

test("tamper: deleting the first day is caught too", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    rmSync(dayPath(root, "2026-10-20"), { recursive: true, force: true });
    assert.ok(errors(root).some((line) => line.includes("sequence number 2 where 1 was expected")));
  } finally { cleanup(); }
});

test("tamper: an unlisted file and a missing listed file are both findings", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    write(root, "2026-10-22", "extra.md", "hello\n");
    rmSync(join(dayPath(root, "2026-10-22"), "accounts/Beta/hours.json"));
    const found = errors(root);
    assert.ok(found.some((line) => line.includes("extra.md") && line.includes("not listed")));
    assert.ok(found.some((line) => line.includes("accounts/Beta/hours.json") && line.includes("missing")));
  } finally { cleanup(); }
});

test("tamper: forged standings that match their hash are still caught by re-deriving them", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    const stars = JSON.parse(read(root, "2026-10-22", "stars.json"));
    stars.crown = { key: "Beta", label: "Beta", score: 99, net: 3 };
    const text = `${JSON.stringify(stars, null, 2)}\n`;
    write(root, "2026-10-22", "stars.json", text);
    const manifest = JSON.parse(read(root, "2026-10-22", "day.json"));
    manifest.files["stars.json"] = { sha256: sha256(text), bytes: Buffer.byteLength(text) };
    write(root, "2026-10-22", "day.json", `${JSON.stringify(manifest, null, 2)}\n`);
    assert.ok(errors(root).some((line) => line.includes("stars.json") && line.includes("crown does not match")));
  } finally { cleanup(); }
});

test("a day whose rules file cannot be found cannot be re-derived, and says so", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    const found = errorsOf(verifyRoot(root, { rulesFor: () => null }).findings).map(formatFinding);
    assert.ok(found.some((line) => line.includes("rules file for v1 was not found")));
  } finally { cleanup(); }
});

test("a stray file in results/ and a folder without a manifest are findings", () => {
  const { root, cleanup } = scratch();
  try {
    season(root);
    writeFileSync(join(root, "results", "notes.txt"), "x");
    mkdirSync(join(root, "results", "2026", "10", "2026-10-30"), { recursive: true });
    const found = errors(root);
    assert.ok(found.some((line) => line.includes("results/notes.txt")));
    assert.ok(found.some((line) => line.includes("2026-10-30") && line.includes("no manifest")));
  } finally { cleanup(); }
});

test("sealing is refused while a day folder without a manifest exists", () => {
  const { root, cleanup } = scratch();
  try {
    freeze(root, "2026-10-20", GOOD);
    mkdirSync(join(root, "results", "2026", "10", "2026-10-30"), { recursive: true });
    assert.throws(() => freeze(root, "2026-10-21", GOOD), (error) => error.code === "BROKEN_CHAIN");
  } finally { cleanup(); }
});

test("an empty results folder verifies, and the first day has no previous link", () => {
  const { root, cleanup } = scratch();
  try {
    assert.deepEqual(verify(root), { findings: [], days: 0 });
    assert.deepEqual(errors(root), []);
  } finally { cleanup(); }
});
