---
name: maeh-showcase
description: Run and triage the MAEH Showcase nightly freeze.
version: 0.1.0
author: IllimitedEnterprise, Hermes Agent
license: MIT
platforms: [windows, linux, macos]
metadata:
  hermes:
    tags: [maeh, showcase, nightly, verification, git]
---

# MAEH Showcase Skill

The MAEH Showcase repository publishes each day's results of eight demo trading accounts as frozen files, with Star crowns and a static dashboard. A script freezes the previous day every night. This skill covers what to do when that script reports something, and the periodic health check. It never changes a frozen day.

## When to Use

- The nightly cron job woke you: the script output shown with your prompt has `ATTENTION` lines, or its last line is JSON with `"wakeAgent": true` and a problem outcome.
- The output says the run was clean but it is a health-check day: follow Procedure B.
- The owner asks whether the showcase is up to date.

Don't use for: changing results, editing the ranking rules, publishing by hand, or touching any trading account.

## Prerequisites

- The working directory is the repository root (the cron job sets it).
- `node` 22 or newer, `git` and `gh` are found by the scripts themselves. Do not install anything.
- Read `AGENTS.md` first: its rules apply to every step below.

## How to Run

Run every command through the `terminal` tool from the repository root.

- `terminal(command="node scripts/nightly.mjs --status")` shows the last frozen day, pending days, unpushed commits and the last run.
- `terminal(command="node scripts/verify.mjs --all")` checks hashes, the chain, the derived files and privacy. It prints `OK` or lists problems.
- `terminal(command="node scripts/nightly.mjs --dry-run")` reads the harness and says what it would freeze, writing nothing.
- `terminal(command="node scripts/nightly.mjs")` runs the whole job again. It is safe to repeat: a day that is frozen is never frozen twice.
- `terminal(command="node scripts/nightly.mjs --retry-push")` pushes commits that were made but not pushed.

## Quick Reference

The script's last line is JSON: `wakeAgent`, `outcome`, `frozen`, `pushed`, `attention`.

| outcome | exit | meaning | first step |
|---|---|---|---|
| `frozen` | 0 | days were frozen, committed, pushed | read `attention`; a partial day needs the report |
| `noop` | 0 | nothing was due | none |
| `unavailable` | 2 | an account could not be read; nothing frozen | runbook: Unavailable |
| `integrity` | 3 | verification or the privacy scan failed | runbook: Integrity (stop) |
| `committed-not-pushed` | 4 | the commit is safe locally | runbook: Push |
| `error` | 5 | git, branch, tree or settings problem | runbook: Environment |

The full decision rules are in `references/runbook.md`.

## Procedure A: triage a wake

1. Read the script output and the final JSON line. Note `outcome` and every `attention` entry. Done when you can say in one sentence what went wrong.
2. `terminal(command="node scripts/nightly.mjs --status")` and `terminal(command="node scripts/verify.mjs --all")`. Done when you have both results in hand.
3. Find the outcome in `references/runbook.md` and do exactly what it allows, nothing more. Done when the runbook's own check for that case passes, or when it tells you to stop.
4. Re-run `terminal(command="node scripts/verify.mjs --all")` and `terminal(command="node scripts/nightly.mjs --status")`. Done when verify prints `OK` and status shows no pending day and no unpushed commit, or you have recorded exactly what still blocks that.
5. Finish with a short report to the owner, at most ten lines: what the script reported, what you did, the state now, and anything that needs the owner. Done when the report names a next step or says nothing further is needed.

## Procedure B: health check

1. `terminal(command="node scripts/nightly.mjs --status")`. Done when you know the latest frozen day and whether any day is pending or unpushed.
2. `terminal(command="gh run list --limit 3 --json name,status,conclusion,createdAt")`. Done when you know whether the latest checks and the Pages deployment succeeded.
3. `terminal(command="hermes cron status")`. Done when you know the scheduler is running.
4. Report one line per item with OK or the problem. A healthy week needs only three lines.

## Pitfalls

- A clean night is silent by design. No message does not mean failure: the health check on its days is what notices a stopped scheduler.
- Frozen means frozen. A partial day is already sealed and published with its reason; you can explain it but not repair it.
- `--accept-partial` is only for a day that stayed blocked because an account could not be read, after the cause is understood. It records your reason in a public commit message, so keep the reason short and free of account details.
- Never stage with `git add -A` or `git add .`. The scripts stage `results` and `stars` by explicit path.
- The derived files under `stars/` and `results/index.json` are rebuilt by `node scripts/rank.mjs`; never edit them.
- Output must stay free of credentials. If a command prints something that looks like one, stop and say so in the report without repeating it.

## Verification

- `node scripts/verify.mjs --all` prints `OK: N day(s)`.
- `node scripts/nightly.mjs --status` shows `pending: none` and `unpushed commits: 0`.
- The report was sent, and it says what changed and what did not.
