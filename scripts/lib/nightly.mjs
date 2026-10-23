/* The nightly job: freeze every day that is due, rank, verify, commit, push.
 *
 * It is written to be run by something that is not watching: idempotent (freezing a day that is
 * frozen is a no-op), self-healing (it freezes every unfrozen day up to yesterday, oldest first,
 * so a missed night is simply caught up), and loud only when it needs to be. Everything it
 * prints is plain ASCII and the LAST line is a JSON object, `{"wakeAgent": ...}`, which the
 * scheduler reads: false means "nothing to look at, do not wake the agent".
 *
 * Exit codes: 0 ok (including nothing to do, and another run in progress)
 *             2 data unavailable, nothing frozen
 *             3 integrity or privacy failure, nothing committed
 *             4 committed but not pushed
 *             5 environment, git or configuration problem */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkDerived } from "./derived.mjs";
import { createGit } from "./git.mjs";
import { HarnessError, createHarness, preflight } from "./harness.mjs";
import { loadAccountsMap, saveAccountsMap } from "./ledger.mjs";
import { acquireLock, LockHeld } from "./lock.mjs";
import {
  capturesFile, freezeDay, gatherDay, lastRunFile, loadContext, quarantineDays, readJson, rebuildDerived, writeJsonAtomic,
} from "./pipeline.mjs";
import { describe, scanFile } from "./privacy.mjs";
import { renderDay } from "./render.mjs";
import { resolveGit } from "./runtime.mjs";
import { SealError, cleanSealing } from "./seal.mjs";
import {
  WEEKDAY_NAMES, addDays, dayWindow, isoWeekKey, lastSettledDate, localDate, pendingDays, weekdayOf,
} from "./time.mjs";
import { errorsOf, formatFinding, listFrozen, verifyRoot } from "./verify.mjs";

const MAX_LINES = 30;
const NIGHTLY_WINDOW_SEC = 6 * 3600; // a day frozen later than this after it ended is a catch-up
const clean = (text) => String(text).replace(/[^A-Za-z0-9 ._:;+/(),=-]/g, "?").slice(0, 200);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runNightly(options) {
  const {
    root, argv = {}, env = process.env, now = () => Date.now(), sleep = wait,
    makeClient = (url) => createHarness({ baseUrl: url }), findGit = () => resolveGit(),
  } = options;

  const lines = [];
  const attention = [];
  const frozen = [];
  let pushed = false;
  let outcome = "noop";
  let health = false;
  const say = (text) => lines.push(clean(text));
  const note = (text) => { attention.push(clean(text)); say(`ATTENTION ${text}`); };

  const finish = (code, label) => {
    if (label) outcome = label;
    const final = { wakeAgent: code !== 0 || attention.length > 0 || health, outcome, frozen: [...frozen], pushed, attention: attention.slice(0, 8) };
    const shown = lines.slice(0, MAX_LINES - 1);
    return { exitCode: code, lines: shown, final, text: `${[...shown, JSON.stringify(final)].join("\n")}\n` };
  };

  let ctx;
  try {
    ctx = loadContext(root, env);
  } catch (error) {
    note(`config problem: ${error.message}`);
    return finish(5, "error");
  }
  const zone = ctx.season.zone;
  mkdirSync(ctx.stateDir, { recursive: true });
  let nowSec = Math.floor(now() / 1000);
  health = ctx.season.healthWakeDays.includes(WEEKDAY_NAMES[weekdayOf(localDate(nowSec, zone))]);

  let gitInfo;
  try {
    gitInfo = findGit();
  } catch (error) {
    note(`environment: ${error.message}`);
    return finish(5, "error");
  }
  const git = createGit({ gitPath: gitInfo.path, cwd: root, env });
  if (!git.isRepo()) {
    note("environment: this folder is not a git repository");
    return finish(5, "error");
  }

  /* ---- push, shared by the normal path and --retry-push ---- */
  function pushStep() {
    if (argv.noPush || !git.remotes().includes("origin")) {
      say("no remote to push to; commits stay local");
      return "no-remote";
    }
    git.fetch("origin", "main");
    const position = git.aheadBehind("origin", "main");
    if (position && position[1] > 0) {
      const rebased = git.rebase("origin/main");
      if (rebased.status !== 0) {
        git.rebaseAbort();
        return "rebase-failed";
      }
    }
    if (git.push("origin", "main").status !== 0) return "push-failed";
    pushed = true;
    return "ok";
  }

  /* ---- --status: look, never touch ---- */
  if (argv.status) {
    health = false;
    const days = listFrozen(root).filter((day) => day.text !== null);
    const latest = days.map((day) => day.date).sort().at(-1);
    say(`frozen days: ${days.length}${latest ? `, latest ${latest} (seq ${days.at(-1).seq})` : ""}`);
    const due = pendingDays({ nowSec, zone, frozen: new Set(days.map((day) => day.date)), settleMin: ctx.season.settleMinutes, seasonStart: ctx.season.seasonStart });
    say(due.length ? `pending: ${due.slice(0, 6).join(", ")}${due.length > 6 ? " ..." : ""}` : "pending: none");
    if (git.remotes().includes("origin")) say(`unpushed commits: ${git.unpushed("origin", "main") ?? "unknown"}`);
    const lastRun = readJson(lastRunFile(ctx), null);
    say(lastRun ? `last run: exit ${lastRun.exit}, ${lastRun.outcome}, frozen ${lastRun.frozen.join(", ") || "nothing"}` : "last run: none recorded");
    return finish(0, "status");
  }

  let lock;
  try {
    lock = acquireLock(join(ctx.stateDir, "lock"), { now });
  } catch (error) {
    if (error instanceof LockHeld) {
      say(error.message);
      health = false;
      return finish(0, "busy");
    }
    throw error;
  }

  async function locked() {
    const branch = git.branch();
    if (branch !== "main") {
      note(`not on the main branch (on ${branch})`);
      return finish(5, "error");
    }
    const dirty = git.dirty(["results", "stars"]);
    if (dirty.length) {
      note(`${dirty.length} uncommitted change(s) in results or stars; leaving them alone`);
      return finish(5, "error");
    }
    cleanSealing(root);

    const check = verifyRoot(root, { rulesFor: ctx.rulesFor });
    const broken = errorsOf(check.findings);
    if (broken.length) {
      note(`verification failed before freezing: ${broken.length} problem(s)`);
      for (const finding of broken.slice(0, 3)) say(formatFinding(finding));
      return finish(3, "integrity");
    }

    if (argv.retryPush) {
      const result = pushStep();
      say(`push: ${result}`);
      return result === "ok" || result === "no-remote" ? finish(0, "pushed") : finish(4, "committed-not-pushed");
    }

    const existing = listFrozen(root).filter((day) => day.text !== null);
    if (existing.length === 0) {
      note("no frozen days yet; the first days come from the backfill command, not from this job");
      return finish(5, "error");
    }
    const frozenDates = new Set(existing.map((day) => day.date));

    /* Hold yesterday back until it has settled, but only for a short, bounded wait. */
    const settleMs = ctx.season.settleMinutes * 60_000;
    const yesterday = addDays(localDate(nowSec, zone), -1);
    if (!frozenDates.has(yesterday) && !argv.noWait) {
      const waitMs = dayWindow(yesterday, zone).endSec * 1000 + settleMs - now();
      if (waitMs > 0 && waitMs <= 45 * 60_000) {
        say(`waiting ${Math.ceil(waitMs / 60_000)} min for ${yesterday} to settle`);
        await sleep(waitMs);
        nowSec = Math.floor(now() / 1000);
      }
    }
    const pending = pendingDays({ nowSec, zone, frozen: frozenDates, settleMin: ctx.season.settleMinutes, seasonStart: ctx.season.seasonStart });
    if (argv.acceptPartial && !pending.includes(argv.acceptPartial)) {
      note(`${argv.acceptPartial} is not a pending day, so there is nothing to accept`);
      return finish(5, "error");
    }
    if (pending.length === 0) {
      say("nothing to freeze: every settled day is already frozen");
      const result = git.remotes().includes("origin") && (git.unpushed("origin", "main") ?? 0) > 0 ? pushStep() : "none";
      if (result === "push-failed" || result === "rebase-failed") return finish(4, "committed-not-pushed");
      return finish(0, "noop");
    }

    /* The live harness, if it is there. */
    let client = null;
    let roster = null;
    try {
      client = makeClient(ctx.priv.harnessUrl);
      roster = await preflight({ client, now, sleep, maxWaitMs: ctx.season.quietWaitMinutes * 60_000, log: say });
      if (!roster.quiet) note("the harness did not go quiet in time; reading anyway");
      saveAccountsMap(ctx.stateDir, roster.accounts, new Date(now()).toISOString());
      const listed = new Set(ctx.allow.map((account) => account.label));
      const unlisted = roster.accounts.filter((account) => account.active && !listed.has(account.label)).length;
      if (unlisted) note(`${unlisted} active account(s) are not on the published list and were not published`);
    } catch (error) {
      if (!(error instanceof HarnessError)) throw error;
      say(`harness unreachable (${error.code ?? "error"}); using the close ledger where it is fresh`);
      client = null;
      roster = null;
    }
    const accountsMap = loadAccountsMap(ctx.stateDir);

    const previous = readJson(capturesFile(ctx), {});
    const records = { ...previous };
    const lastSettled = lastSettledDate(nowSec, zone, ctx.season.settleMinutes);
    const sealed = [];
    let skipped = 0;

    for (const date of pending) {
      const window = dayWindow(date, zone);
      const kind = date === lastSettled && nowSec - window.endSec <= NIGHTLY_WINDOW_SEC ? "nightly" : "catchup";
      const gathered = await gatherDay({ ctx, date, nowSec, client, roster, accountsMap, previous, log: () => {} });
      if (gathered.unusable.length && argv.acceptPartial !== date) {
        note(`${date}: no complete source for ${gathered.unusable.length} account(s); not frozen`);
        skipped += 1;
        continue;
      }
      if (argv.dryRun) {
        const rendered = renderDay({ date, window, kind, accounts: gathered.captures, rules: ctx.rules });
        say(`${date}: would freeze as ${kind}, ${rendered.status}, desk net ${rendered.desk.net}, ${rendered.desk.n} closes`);
        continue;
      }
      try {
        const result = freezeDay({ ctx, date, kind, captures: gathered.captures, nowSec });
        sealed.push({ date, kind, result });
        frozen.push(date);
        const partial = result.rendered.days.filter((day) => day.status === "partial" || day.status === "unverified").length;
        if (partial) note(`${date}: ${partial} account(s) are partial or unverified`);
        for (const entry of gathered.captures) {
          for (const problem of entry.capture?.problems ?? []) if (problem.attention) note(`${date}: ${describeAttention(problem)}`);
          if (kind === "nightly" && entry.capture?.captureRecord) records[entry.allow.key] = entry.capture.captureRecord;
        }
      } catch (error) {
        if (!(error instanceof SealError)) throw error;
        if (error.code === "ALREADY_FROZEN") continue;
        note(`${date}: refused to freeze (${error.code})`);
        say(error.message);
        return finish(3, "integrity");
      }
    }

    if (argv.dryRun) return finish(0, "dry-run");
    if (frozen.length === 0) {
      return skipped ? finish(2, "unavailable") : finish(0, "noop");
    }

    /* Derived files, then everything is verified again as a whole before anything is committed. */
    const undo = (reason) => {
      quarantineDays(ctx, frozen);
      try { rebuildDerived(ctx); } catch { /* the repository is restored to what it was */ }
      note(reason);
      frozen.length = 0;
      return finish(3, "integrity");
    };
    let derived;
    try {
      derived = rebuildDerived(ctx);
    } catch (error) {
      return undo(`derived rebuild failed: ${error.message}`);
    }
    const afterwards = [...errorsOf(verifyRoot(root, { rulesFor: ctx.rulesFor }).findings), ...checkDerived(root, derived.files)];
    if (afterwards.length) {
      for (const finding of afterwards.slice(0, 3)) say(formatFinding(finding));
      return undo(`verification failed after freezing: ${afterwards.length} problem(s); the new days were set aside`);
    }

    /* Commit by explicit path, and only additions to frozen folders. */
    git.add(["results", "stars"]);
    const staged = git.staged();
    const edited = staged.filter((entry) => /^results\/\d{4}\//.test(entry.path) && entry.status !== "A");
    if (edited.length) {
      git.exec(["reset", "-q"]);
      return undo("refusing to commit a change to a frozen file");
    }
    const kinds = [...new Set(sealed.map((entry) => entry.kind))].join("/");
    const accounts = sealed.flatMap((entry) => entry.result.rendered.days).filter((day) => day.status !== "prefunding");
    const clean_ = accounts.filter((day) => day.status === "ok" || day.status === "quiet").length;
    let message = `freeze: ${frozen.join(", ")} (${kinds}, ${clean_}/${accounts.length} account-days clean)\n`;
    if (argv.acceptPartial && argv.reason) {
      const reason = clean(argv.reason).slice(0, 120);
      const findings = scanFile("reason.txt", reason);
      if (findings.length) return undo(`the reason was refused: ${findings.map(describe).join("; ")}`);
      message += `\naccepted as partial: ${reason}\n`;
    }
    git.commit(message);
    say(`committed ${frozen.length} day(s): ${frozen.join(", ")}`);

    /* A week that has just closed is tagged with the chain tip, so the history cannot be quietly rewritten. */
    const tags = [];
    const tip = derived.model.days.reduce((best, day) => (!best || day.seq > best.seq ? day : best), null);
    for (const date of frozen) {
      if (weekdayOf(date) !== 0) continue;
      const name = `chain-${isoWeekKey(date)}`;
      if (git.tagExists(name)) continue;
      git.tag(name, `chain tip: seq ${tip.seq}, ${tip.date}, manifest ${tip.sha256.slice(0, 16)}\n`);
      tags.push(name);
    }

    writeJsonAtomic(capturesFile(ctx), records);
    const result = pushStep();
    if (result === "ok") for (const name of tags) git.push("origin", `refs/tags/${name}`);
    say(`push: ${result}`);

    if (result === "push-failed" || result === "rebase-failed") {
      note("the commit is safe locally but could not be pushed; run again with --retry-push");
      return finish(4, "committed-not-pushed");
    }
    return finish(0, "frozen");
  }

  try {
    const result = await locked();
    if (!argv.status && !argv.dryRun) {
      try {
        writeJsonAtomic(lastRunFile(ctx), { at: new Date(now()).toISOString(), exit: result.exitCode, outcome: result.final.outcome, frozen: result.final.frozen, attention: result.final.attention, pushed: result.final.pushed });
      } catch { /* a state folder that cannot be written must not hide the result */ }
    }
    return result;
  } catch (error) {
    note(`unexpected problem: ${error.message}`);
    return finish(5, "error");
  } finally {
    lock.release();
  }
}

function describeAttention(problem) {
  if (problem.code === "terminal-forgot") return `${problem.n} close(s) are in the ledger but no longer in the terminal history`;
  return problem.code;
}
