/* Freezing a day.
 *
 * A day is written to a temporary folder, read back from the disk and verified exactly as a
 * stranger would verify it, and only then renamed into place in one step. A half-written day
 * can therefore never be mistaken for a frozen one, and a folder that already exists is never
 * touched: freezing the same date twice is an error, not an overwrite.
 *
 * The manifest, day.json, is written last because it lists the SHA-256 and size of every other
 * file, the zone and exact UTC window of the day, and a link to the previous day's manifest
 * (by sequence number, which is freeze order, so a late backfill cannot break the chain). */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256, stringify } from "./canonical.mjs";
import { describe, scanFiles } from "./privacy.mjs";
import { project } from "./project.mjs";
import { windowRecord } from "./time.mjs";
import { checkDay, errorsOf, formatFinding, listFrozen, readDayFiles } from "./verify.mjs";

export class SealError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SealError";
    this.code = code;
  }
}

export const dayPath = (root, date) => join(root, "results", date.slice(0, 4), date.slice(5, 7), date);

const isoOf = (sec) => new Date(sec * 1000).toISOString().replace(".000Z", "Z");

/* Remove leftovers of a run that died between writing and renaming. */
export function cleanSealing(root) {
  const base = join(root, "results");
  if (!existsSync(base)) return [];
  const removed = [];
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith(".sealing-")) continue;
    rmSync(join(base, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

/* `rendered` is the result of renderDay. `rules` is the parsed rules file for this day. */
export function sealDay({ root, date, rendered, kind, capturedAtSec, zone, window, rules }) {
  const finalDir = dayPath(root, date);
  if (existsSync(finalDir)) throw new SealError("ALREADY_FROZEN", `${date} is already frozen and is never overwritten`);

  const frozen = listFrozen(root);
  if (frozen.some((day) => day.text === null)) throw new SealError("BROKEN_CHAIN", "a day folder without a manifest exists; run verify before freezing more");
  const last = frozen.at(-1) ?? null;

  const files = {};
  for (const [path, text] of rendered.files) files[path] = { sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8") };
  const manifest = project("day", {
    schema: 1, seq: last ? last.seq + 1 : 1, date, zone, window: windowRecord(window), kind,
    status: rendered.status, capturedAt: isoOf(capturedAtSec), rules: rules.version,
    accounts: rendered.accountStatuses, files,
    prev: last ? { seq: last.seq, date: last.date, sha256: sha256(last.text) } : null,
  });
  const manifestText = stringify(manifest);

  const everything = new Map([...rendered.files, ["day.json", manifestText]]);
  const findings = scanFiles(everything);
  if (findings.length) throw new SealError("PRIVACY", `refusing to write ${date}: ${findings.slice(0, 5).map(describe).join("; ")}`);

  const temp = join(root, "results", `.sealing-${date}-${process.pid}`);
  rmSync(temp, { recursive: true, force: true });
  try {
    for (const [path, text] of everything) {
      const target = join(temp, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text, "utf8");
    }
    const problems = errorsOf(checkDay({ date, files: readDayFiles(temp), rules }));
    if (problems.length) throw new SealError("VERIFY", `${date} did not verify as written: ${problems.slice(0, 5).map(formatFinding).join(" | ")}`);
    mkdirSync(dirname(finalDir), { recursive: true });
    renameSync(temp, finalDir);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  return { dir: finalDir, seq: manifest.seq, manifestSha256: sha256(manifestText), manifest };
}
