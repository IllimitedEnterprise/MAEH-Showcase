# AGENTS.md

Notes for automated agents and for people who maintain this repository.

## What this is

MAEH Showcase publishes the daily results of eight demo trading accounts. Each night
the previous local day is frozen into `results/YYYY/MM/YYYY-MM-DD/`. `stars/` holds
the derived rankings and crowns. `site/` is the static dashboard served by GitHub
Pages. The code is plain Node (version 22 or newer) with no dependencies.

## Rules that never bend

1. Anything under `results/YYYY/` is append-only. Add new day folders. Never edit,
   rename or delete a file inside an existing one.
2. History is append-only too: no force-push, no rewriting of published commits, no
   deleting a branch or a tag.
3. Stage files by explicit path (`results`, `stars`). Never run `git add -A` or
   `git add .`.
4. Keep credentials out of every file, log line and message. No script here needs
   one on its command line.
5. When a frozen day would have to change, stop and escalate to the repository owner.

## Commands an agent may run

- `node scripts/verify.mjs --all` checks file hashes, the chain, privacy and the
  derived files.
- `node scripts/nightly.mjs --status` shows the last frozen day, any gaps and the
  last run.
- `node scripts/nightly.mjs --dry-run` reads and renders but writes nothing.
- `node scripts/nightly.mjs` runs the whole job; it is safe to repeat, because a
  frozen day is never frozen twice.
- `node scripts/nightly.mjs --retry-push` pushes commits that were made but not
  pushed yet.
- `node scripts/nightly.mjs --accept-partial YYYY-MM-DD --reason "text"` seals a day
  that the checks flagged as partial, and records the reason.
- Read-only queries: `gh run list`, `gh run view`, `hermes cron status`,
  `hermes cron runs`.

Nothing else is needed for the nightly job. The runbook for each problem the script
can report is in `.agents/skills/maeh-showcase/references/runbook.md`.

## Published data

Public files carry account labels, per-trade rows (symbol, side, net result, R) and
trade counts per entry hour. They never carry tickets, comments, volume, prices,
broker logins, server names, paths, ports, harness ids, strategy names, equity or
floating figures, or raw error text. `scripts/lib/project.mjs` builds every public
object from an allowlist, and `node scripts/verify.mjs --all` scans the files again.

## Layout

- `config/` holds the season settings, the published-account list and the versioned
  ranking rules.
- `scripts/` holds the command line tools; `scripts/lib/` holds their modules.
- `test/` holds the tests. Run them with `node --test "test/**/*.test.mjs"`.
- `site/` is the dashboard; `node scripts/serve.mjs` previews it locally.
- `docs/METHODS.md` explains how every number is computed.

## Conventions

Files are LF. Commit messages follow Conventional Commits. Write files only through
the repository's own scripts or an editor that does not add a byte order mark.
