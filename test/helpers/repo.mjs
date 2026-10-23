/* A throwaway repository for end-to-end tests of the nightly job: real git, the real hooks, a
 * bare remote, a private state folder and a harness var folder with ledgers. */

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGit } from "../../scripts/lib/git.mjs";
import { loadContext, rebuildDerived } from "../../scripts/lib/pipeline.mjs";
import { resolveGit } from "../../scripts/lib/runtime.mjs";
import { ALLOW, freeze } from "./days.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const real = (...parts) => join(REPO, ...parts);

export function gitAvailable() {
  try {
    return resolveGit();
  } catch {
    return null;
  }
}

export const GOOD = {
  Alpha: [[1, 1, 4_000], [2, 2, 3_000], [3, 3, 5_000], [4, 4, -1_000]],
  Beta: [[5, 1, 100], [6, 2, 100], [7, 3, 100]],
};

export function makeRepo({ seasonStart = "2026-10-20", healthWakeDays = [], seed = ["2026-10-20", "2026-10-21"], remote = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "maeh-nightly-"));
  const root = join(base, "repo");
  const state = join(base, "state");
  const varDir = join(base, "harness-var");
  const bare = join(base, "remote.git");
  for (const dir of [root, state, varDir]) mkdirSync(dir, { recursive: true });

  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "season.json"), `${JSON.stringify({
    schema: 1, zone: "Europe/Berlin", seasonStart, rules: "v1", settleMinutes: 30, quietWaitMinutes: 45, healthWakeDays,
  }, null, 2)}\n`);
  writeFileSync(join(root, "config", "accounts.json"), `${JSON.stringify({
    schema: 1, accounts: ALLOW.map(({ key, label, fundedDate }) => ({ label, key, fundedDate })),
  }, null, 2)}\n`);
  copyFileSync(real("config", "rules.v1.json"), join(root, "config", "rules.v1.json"));
  cpSync(real(".githooks"), join(root, ".githooks"), { recursive: true });
  copyFileSync(real(".gitattributes"), join(root, ".gitattributes"));

  const info = gitAvailable();
  const git = createGit({ gitPath: info.path, cwd: root });
  git.exec(["init", "-q", "-b", "main"]);
  for (const [key, value] of [["user.name", "Frequency"], ["user.email", "bot@example.invalid"], ["core.hooksPath", ".githooks"], ["core.autocrlf", "false"], ["commit.gpgsign", "false"]])
    git.exec(["config", key, value]);

  const env = { ...process.env, MAEH_SHOWCASE_STATE: state, MAEH_HARNESS_VAR: varDir };
  for (const date of seed) freeze(root, date, GOOD);
  if (seed.length) {
    const ctx = loadContext(root, env);
    rebuildDerived(ctx);
  }
  git.add(["config", ".githooks", ".gitattributes", "results", "stars"].filter((path) => existsSync(join(root, path))));
  git.commit("chore: seed\n");

  if (remote) {
    git.exec(["init", "-q", "--bare", "-b", "main", bare]);
    git.exec(["remote", "add", "origin", bare]);
    git.exec(["push", "-q", "-u", "origin", "main"]);
  }
  return {
    root, state, varDir, bare, git, env, gitInfo: info,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/* A ledger folder for one account, in the layout the harness keeps. */
export function writeLedger(varDir, accountId, rows, { mtimeSec, anchor = { deposits: 50000, fundingAt: 1_790_000_000, currency: "EUR" } } = {}) {
  const live = join(varDir, "accounts", accountId, "live");
  mkdirSync(live, { recursive: true });
  const file = join(live, "broker-closes.ndjson");
  writeFileSync(file, rows.map((row) => JSON.stringify({ schema: 1, symbol: "EURUSD", type: 0, direction: "LONG", ...row })).join("\n") + (rows.length ? "\n" : ""));
  if (mtimeSec !== undefined) utimesSync(file, mtimeSec, mtimeSec);
  if (anchor) writeFileSync(join(live, "broker-closes-account.json"), JSON.stringify(anchor));
  return live;
}

export const hasRef = (git, ref) => git.exec(["rev-parse", "--verify", "--quiet", ref], { allowFail: true }).status === 0;
export const exists = existsSync;
