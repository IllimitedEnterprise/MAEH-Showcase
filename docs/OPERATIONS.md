# Operations

How the nightly freeze runs, what its outcomes mean, how to recover, and how the site gets published.
The agent's own runbook is [`.agents/skills/maeh-showcase/references/runbook.md`](../.agents/skills/maeh-showcase/references/runbook.md);
the one-time Hermes wiring is [`deploy/hermes/HERMES-SETUP.md`](../deploy/hermes/HERMES-SETUP.md).

## The night in one picture

```
01:00 Berlin   scheduler (Hermes) runs the shim  ->  node scripts/nightly.mjs
                 lock  ->  git preflight  ->  find every day that is due (oldest first)
                 wait for the day to settle (30 min after midnight)
                 harness preflight (reachable, not mid-refresh)  ->  read each account
                 render the day  ->  seal it (temp folder, verify, one rename)
                 rebuild the Star files (twice, must be identical)  ->  verify everything
                 commit exactly results/ and stars/  ->  push (never forced)  ->  tag on Sundays
               last line of output: {"wakeAgent": false, ...}  -> a quiet night stops here
push to main   CI runs; the Pages workflow verifies again and deploys the new day
```

The job is **idempotent and self-healing**: a day that is frozen is never frozen twice, and every
unfrozen day up to yesterday is frozen in order, so a missed night is simply caught up the next time.
Another run in progress is detected by a lock and exits quietly.

## Commands

| Command | What it does |
|---|---|
| `node scripts/nightly.mjs --status` | last frozen day, gaps, last run; changes nothing |
| `node scripts/nightly.mjs --dry-run` | reads and renders, writes nothing |
| `node scripts/nightly.mjs` | the whole job |
| `node scripts/nightly.mjs --retry-push` | pushes commits that were made but not pushed |
| `node scripts/nightly.mjs --accept-partial YYYY-MM-DD --reason "text"` | seals a day the checks flagged partial, recording why |
| `node scripts/verify.mjs --all` | verifies every file, the chain, the rules, privacy |
| `node scripts/verify.mjs --history` | scans every commit ever made for private data and secrets |
| `node scripts/rank.mjs --check` | rebuilds the Star files and compares byte for byte |
| `node scripts/serve.mjs` | previews the dashboard at `http://127.0.0.1:4173/MAEH-Showcase/` |
| `node scripts/build-site.mjs` | assembles the Pages artifact into `_site/` (never committed) |
| `node scripts/setup.mjs` | shows, and with `--yes` applies, this checkout's git setup |

## Outcomes

Output is at most 30 lines of plain ASCII, and **the last line is JSON**:
`{"wakeAgent":false,"outcome":"frozen","frozen":["2026-10-23"],"pushed":true,"attention":[]}`.
`wakeAgent` is `true` when the exit code is not 0, when there is an attention line, or on a
health-check day (Monday, Wednesday and Saturday, set in `config/season.json`). When it is `false` the
scheduler stops: no model call, no message.

| Exit | Outcome | Meaning | What to do |
|---:|---|---|---|
| 0 | `frozen` / `noop` | frozen and pushed, or nothing was due | nothing |
| 2 | `unavailable` | could not read at least one account for a due day; nothing frozen | wait; the next run freezes every pending day |
| 3 | `integrity` | verification or the privacy scan failed; nothing was committed | stop; read the first findings; the owner decides |
| 4 | `committed-not-pushed` | the commit exists locally | `node scripts/nightly.mjs --retry-push`; check `gh auth status` |
| 5 | `error` | environment, git or configuration | read the attention line |

A day with one unreadable account is **not** held back forever: after the same account stays
unreadable on two nights and the cause is understood, `--accept-partial` seals the day with that
account marked partial, and every page says so.

## The machine

The nightly job runs on the owner's PC, because that is where the trading harness is.

- **Awake at 01:00.** The scheduler cannot wake a sleeping PC. Turn off sleep and hibernate, or allow a
  wake timer. If it was off, the job runs once when it is back and catches up.
- **The Hermes gateway is running** (`hermes cron status`) and starts again after every logon.
- **Node 22 or newer and Git** are found by the shim and the scripts from their usual places; none needs
  to be on `PATH`.
- **GitHub sign-in:** `gh auth status` shows the account that owns the repository. `node scripts/setup.mjs
  --yes` points this checkout's pushes at the GitHub CLI's saved sign-in so no prompt can ever appear.
- **The private settings file** `%LOCALAPPDATA%\MAEH-Showcase\config.json` names the harness's local
  address and its `var` folder. It never leaves the machine.

### Where private state lives

`%LOCALAPPDATA%\MAEH-Showcase\` holds the lock, the last run's record, the label-to-id map, the balances
used by the balance chain, and `quarantine\` (anything a failed night set aside; nothing is ever
deleted). None of it is committed, and none of it is needed to read or verify the public data.

## Publishing

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: the whole test suite on Linux
  (Node 22 and 24) and Windows (Node 24), then the data checks.
- **Pages** (`.github/workflows/pages.yml`) runs on every push to `main`: it verifies the data and the
  site, assembles `_site/`, and deploys. The nightly push therefore refreshes the site by itself.
- Actions are pinned to full commits; Dependabot proposes newer pinned versions weekly.
- **Branch protection** on `main` blocks force-pushes and deletion but does not require pull requests, so
  the nightly can push.
- The live address is `https://illimitedenterprise.github.io/MAEH-Showcase/`.

`gh run list --repo IllimitedEnterprise/MAEH-Showcase` shows the last runs; `gh run view <id> --log-failed`
shows why one failed.

## Rehearsing the night

To watch the whole job work against the live harness without touching anything real, run it in a throwaway
copy. The harness is only read; everything the job writes goes to the copy.

1. Clone this checkout, remove its newest frozen day (`git rm -r results/YYYY/MM/<date>`), run
   `node scripts/rank.mjs`, and commit. A fresh clone has no hooks, so the removal is allowed there; in the
   real checkout it never is.
2. `git init --bare` a temporary remote, point the copy's `origin` at it, and push.
3. Make an empty folder for private state, copy only `config.json` into it, and set `MAEH_SHOWCASE_STATE` to
   that folder.
4. From the copy, run `node scripts/nightly.mjs`, or the Hermes shim with `MAEH_SHOWCASE_REPO` pointing at
   the copy and an environment as bare as a scheduler's (no tokens, `PATH` with only the system folders).

What to expect: the day is frozen, one commit that only adds files under the frozen folder and rewrites
derived files, a push to the temporary remote, and a last line `{"wakeAgent":false,...}`. Compare the new day
with the sealed one: the money, `trades.json` and `trades.csv` agree byte for byte, while `source`, `kind`, the
balance check (`null` on a first read, because there is no earlier balance to compare with) and the entry hours
of trades the ledger had no entry time for differ by design. A second run finds nothing due and stays asleep;
an empty file named `force-wake` in the state folder wakes the agent once, which is how a health check is
drilled.

## When something goes wrong

| You see | Likely cause | Do |
|---|---|---|
| no new day in the morning, scheduler silent | PC was asleep, or the gateway is down | `hermes cron status`; start the gateway; the next run catches up |
| `unavailable`, an account unreadable | harness down, restarting or busy | `--dry-run` later; do not freeze by hand |
| `integrity` | a file or the chain failed verification | stop and read; never edit under `results/`; report to the owner |
| `committed-not-pushed` | network or sign-in | `--retry-push`; `gh auth status` |
| CI red on a push | a test, or the data check, failed | `gh run view --log-failed`; the nightly's own verify passed, so look at the platform leg |
| Pages red | the verify or site check failed, or Pages is not enabled | read the log; Pages settings are Settings > Pages > Source: GitHub Actions |
| the site shows an old day | the deploy has not finished, or a ten-minute cache | wait; the page appends the build id to every data request |
| a day looks wrong | the harness had a gap | the balance chain would have marked it partial; frozen days are never edited, the next day is unaffected |

**A frozen day is never changed.** If one is wrong, the fix is a note and a new rules version, never an
edit: the chain exists so that nobody, including the owner, can quietly rewrite history.

## Changes that are the owner's decision

- **Adding or removing an account:** edit `config/accounts.json` (label, key, funded date). An account the
  harness reports that is not on the list is reported and left unpublished.
- **Changing how Stars are scored:** add `config/rules.v2.json` and point `config/season.json` at it.
  Existing days keep the rules they were sealed under.
- **Changing the schedule's days of attention:** `healthWakeDays` in `config/season.json`.
- **Changing the zone:** do not. A new zone would change what a day is.

## The agent

A DeepSeek agent in Hermes is woken only when the nightly script says so. It follows the `maeh-showcase`
skill, may run only the commands listed in [`AGENTS.md`](../AGENTS.md), and escalates to the owner the
moment a frozen day would have to change. It never edits `results/`, never forces a push, and never
stages with `git add -A`.

## Daylight saving

The zone is real, so nothing needs doing: **2026-10-25** is a 25-hour day and **2027-03-28** a 23-hour day,
and the histograms show the extra or missing hour. Hermes has no timezone of its own set, so its 01:00 may
drift an hour for a night after a change; the job's 30-minute settle wait makes that harmless. Setting
`timezone: Europe/Berlin` in Hermes's config removes the drift (step 2 of the Hermes setup).
