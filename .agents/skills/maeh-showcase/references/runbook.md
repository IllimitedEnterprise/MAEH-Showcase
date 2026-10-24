# Runbook: what each outcome means and what is allowed

Every case ends the same way: verify, then a short report. Nothing here changes a frozen day.

## Unavailable (exit 2, outcome `unavailable`)

The script could not read at least one account for a due day, so it froze nothing for that day. The cause is almost always the trading harness being down, restarting, or busy.

1. Run `node scripts/nightly.mjs --dry-run`. If it now says it would freeze the day, the harness is back.
2. Then run `node scripts/nightly.mjs` once. Done when its outcome is `frozen`.
3. If the dry run still cannot read an account, wait and try again later in the same run, at most twice, a few minutes apart.
4. Still blocked after that: do not freeze anything by hand. Report which day is pending and that the harness appears unavailable. The next night's run freezes every pending day in order, so nothing is lost by waiting.
5. Only after two consecutive nights where the same account stayed unreadable, and with the cause understood, run `node scripts/nightly.mjs --accept-partial YYYY-MM-DD --reason "short plain reason"`. This seals the day with that account marked partial.

## Partial or unverified day (outcome `frozen`, attention mentions partial)

The day is sealed and published with the reason inside it (`results/YYYY/MM/DATE/README.md` and each account's `summary.md`). You cannot repair it. Read the reason, tell the owner what it says, and check that `node scripts/verify.mjs --all` is `OK`. A partial account is left out of that day's crown, and the page says so.

## Integrity (exit 3, outcome `integrity`)

Verification or the privacy scan failed, so nothing was committed. This is the one case where you stop.

1. Run `node scripts/verify.mjs --all` and copy the first three findings into your report.
2. Do not delete, move or edit any file under `results/`, and do not run `git reset`, `git checkout` or `git clean`.
3. Newly sealed days that failed after freezing were moved aside by the script into its state folder, not deleted.
4. Report to the owner immediately with the findings. The repository stays as it is until the owner decides.

## Push (exit 4, outcome `committed-not-pushed`)

The commit exists locally. Run `node scripts/nightly.mjs --retry-push`. If it fails again, run `gh auth status` and read the first lines. A credentials problem is for the owner: report it. A rejected non-fast-forward means someone else pushed first; the script already tried one fetch and rebase, so report it instead of forcing anything.

## Environment (exit 5, outcome `error`)

Read the attention text. The usual causes and what to do:

- Not on the `main` branch, or uncommitted changes in `results` or `stars`: report them. Leave the working tree exactly as it is.
- No frozen days yet: the history comes from a one-time backfill, not from this job. Report it.
- git, node or the settings could not be found: report which one.
- The scheduler's shim says `no Node 22 or newer was found; set MAEH_NODE` or `the MAEH Showcase repository was not found; set MAEH_SHOWCASE_REPO`: the job did not run at all, so nothing was frozen tonight. Report the exact message. The fix is a setting in the owner's Hermes environment, so leave Hermes's own configuration alone and do not try to work around it.

## Unlisted account

The script reports `active account(s) are not on the published list`. Nothing was published for them, by design. Tell the owner; adding an account to `config/accounts.json` is the owner's decision.

## Clean night on a health-check day

Follow Procedure B in `SKILL.md`.

## When to stop and escalate

Stop and report to the owner whenever a step would need to edit, delete or rename anything under `results/`, rewrite git history, change `config/rules.v1.json`, or use a credential. Say what you found and what you did not touch.
