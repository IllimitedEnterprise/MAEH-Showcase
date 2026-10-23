/* Reading the harness's own close ledger, and the private label-to-id map.
 *
 * The ledger (`var/accounts/<id>/live/broker-closes.ndjson`) is append-only and holds every
 * close the harness has seen, with money and entry times but no balance and no R. It is the
 * fallback when a live read is unavailable, and the only source for history older than the
 * 500-row cap of a progress read. Reading it never writes to the harness. */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toCents } from "./canonical.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export const ledgerDir = (varDir, accountId) => join(varDir, "accounts", accountId, "live");

function parseLines(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const rows = [];
  let bad = 0;
  let tornTail = false;
  lines.forEach((line, index) => {
    try {
      rows.push(JSON.parse(line));
    } catch {
      if (index === lines.length - 1) tornTail = true;
      else bad += 1;
    }
  });
  return { rows, bad, tornTail };
}

/* Every ledger row, plus what could not be read. A half-written last line is retried once
 * (the harness may be mid-append) and then ignored and reported. */
export async function readLedger(liveDir, { sleep = wait, readFile = (path) => readFileSync(path, "utf8"), stat = statSync } = {}) {
  const file = join(liveDir, "broker-closes.ndjson");
  let parsed = parseLines(readFile(file));
  if (parsed.tornTail) {
    await sleep(250);
    parsed = parseLines(readFile(file));
  }
  return {
    rows: parsed.rows,
    badLines: parsed.bad,
    torn: parsed.tornTail,
    mtimeSec: Math.floor(stat(file).mtimeMs / 1000),
  };
}

/* The funding record the harness keeps beside the ledger: what the account was funded with, and when. */
export function readAnchor(liveDir, { readFile = (path) => readFileSync(path, "utf8"), exists = existsSync } = {}) {
  const file = join(liveDir, "broker-closes-account.json");
  if (!exists(file)) return null;
  try {
    const anchor = JSON.parse(readFile(file));
    return {
      fundingCents: finite(anchor?.deposits) ? toCents(anchor.deposits) : null,
      fundingAtSec: finite(anchor?.fundingAt) ? Math.floor(anchor.fundingAt) : null,
      currency: typeof anchor?.currency === "string" ? anchor.currency.slice(0, 12) : null,
    };
  } catch {
    return null;
  }
}

/* label -> { id, seenAt }, kept outside the repository. Harness ids are random per install,
 * so the map is refreshed on every successful /accounts read and used to find ledgers later. */
const MAP_FILE = "accounts-map.json";

export function loadAccountsMap(stateDir, { readFile = (path) => readFileSync(path, "utf8"), exists = existsSync } = {}) {
  const file = join(stateDir, MAP_FILE);
  if (!exists(file)) return {};
  try {
    const map = JSON.parse(readFile(file));
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

export function saveAccountsMap(stateDir, accounts, seenAtIso) {
  mkdirSync(stateDir, { recursive: true });
  const map = loadAccountsMap(stateDir);
  for (const account of accounts) map[account.label] = { id: account.id, seenAt: seenAtIso };
  const file = join(stateDir, MAP_FILE);
  const temp = `${file}.tmp-${process.pid}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temp, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  renameSync(temp, file);
  return map;
}
