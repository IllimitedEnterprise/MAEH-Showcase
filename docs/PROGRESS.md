# Progress

What was built, in what order, and what was checked at each step. Every entry is a commit in this
repository; the gate is what had to be true before the next step began.

## 2026-10-23: from nothing to a frozen, verified, browsable season

| Step | Commit | What | Gate that passed |
|---|---|---|---|
| Bootstrap | `df20523` | licences (MIT code, CC BY 4.0 data), disclaimer, `.gitattributes` (frozen paths never rewritten), hooks, config, `AGENTS.md` | the repository exists, standalone, nothing from the Control Center |
| Time and metrics | `038efaf` | daylight-saving-safe local days, canonical JSON, tool discovery, metrics identical to the harness's | day windows tile with no gap or overlap for 2026 to 2028; the 25-hour and 23-hour days, the ambiguous hour, ISO week 53; ten golden cases generated once by the harness's own function agree to the cent |
| Public shape and sources | `d715301` | the allowlist projection, the privacy scan, a read-only harness client, the ledger reader | a fixture with logins, servers and paths in it comes out with none of them; 409, 503, timeout, truncation, duplicates and a torn ledger tail are all handled |
| Capture, score, seal, verify | `199bb5d` | reading an account's day from two sources, the Star score, rendering a day, sealing it once, verifying it as a stranger would | a flipped byte names the file; an edited manifest breaks the next day's link; a deleted day is a gap; an unlisted file is an error |
| Crowns | `23b08c3` | week and month crowns, the all-time tally, streaks, the derived standings files | ties, no qualifier, a lucky three beating a solid sixty (it does not), no-loss profit factors, partial periods, ISO week 53; two builds are byte-identical |
| The nightly job | `231d02c` | lock, careful git wrapper, the whole pipeline, hooks, a fake harness | twenty end-to-end scenarios against a real git repository with the real hooks and a bare remote, every exit code drilled |
| Tools | `dc370af` | `verify`, `rank`, `backfill` with the ledger-versus-balance gate, a whole-history scan | the gate printed, per account, that funding plus every ledger close equals the live balance |
| R multiples | `6ef036f` | R on ledger-sourced closes, joined from the execution journal | figures from the two sources agree on every money field |
| **The data** | `2249392` | **sixteen days, 2026-10-07 to 2026-10-22, frozen from the close ledgers** | all eight accounts reconcile to the cent (gap 0.00); `verify` and `rank --check` pass |
| Hermes pack | `fcc1356` | the scheduler shim, the skill, the runbook, the setup guide and the job prompt | the wake gate and the redactor contract asserted on every output; Hermes's own injection scanner passes `AGENTS.md` and the skill |
| The dashboard | `08cee1e` | the Aurora glass site, the preview server, the Pages build | every route and every file of every day drawn from real data and audited; contrast checked on every surface; inspected in a real browser at three widths in both themes |
| CI and setup | `cf8fbaa` | the CI and Pages workflows, Dependabot, a repository-local setup script; the hooks made executable | the whole suite, 341 tests, passes in a clean git environment (no identity, no config) |
| Report polish | `b5e54b6` | days before an account was funded are left out of its written report | derived files regenerated, `verify` and `rank --check` pass |

## Found and fixed on the way

Not every defect was in the plan, so these are listed rather than hidden.

- **The git hooks were committed non-executable.** Linux and macOS clones would have silently skipped
  them. Now mode 755, set by `setup.mjs`, and set by the test helper.
- **A sideways scroll on every page.** The header's background layer overshot the viewport; found by
  probing the layout in a real browser, fixed, and the probe run on all routes at three widths.
- **Grid columns stretched by a wide table.** One long table forced a day page past the screen on a
  phone; fixed by letting single-column grids shrink.
- **Colours that looked fine and were not.** The contrast test found muted text, the loss colour and the
  heat cells under 4.5:1 where the aurora is brightest; all corrected.
- **A moving background under glass.** An early aurora animation made screenshots stall and would cost
  every card a re-blur per frame; removed.
- **Two font descriptors that overstated what the files hold.** Corrected after reading the font tables.
- **Calendar and chart details:** axis ticks that were unevenly spaced, a stray `)` in a Markdown link,
  figures clipped in narrow calendar cells, a duplicated title.
- **Test fixtures that looked like secrets.** The privacy tests carried fake keys and tokens, and the
  full-history scan rightly flagged them (CI would have gone red on its first run). The samples are now
  assembled at run time, and, because nothing had been pushed yet, the local history was rewritten once so
  that **no commit anywhere contains a secret-shaped string**: `verify --history` passes over every blob,
  with no exception list.
- **Private details in public files.** A documentation test found the harness's port and a local folder
  path in the setup guide; both are placeholders now, and the test keeps them out.

## Checked a second way

An independent recomputation, written separately from this repository's code (its own Berlin-date logic and
its own sums), re-derived every published day and account (72 day-and-account cells) straight from the
harness's own close ledgers: **0 mismatches**, and 2,094 closes with a net of +2,048.94, equal to the
published totals. The ledgers also hold today's closes, which belong to a day that has not ended and are
rightly absent.

An independent privacy audit, again sharing no code with the project's scanner, read all 462 published data
files: 163 distinct JSON keys, every one a known schema field and none a forbidden one; the only free text
is eight account labels, eighteen instrument names, `long` and `short`, status words and hour labels; the
only instants are in manifests; no address, path, host, port, e-mail or long number anywhere; **0 hits**.

A hostile-data test serves the real files with script tags, event handlers, `javascript:` links and image
payloads swapped into every label, symbol, reason and Markdown file, draws every route, and parses each
page's real tags and attributes: nothing came out as markup. It found one defect (an account name such as
`__proto__` reached `Object.prototype` instead of the not-found page), now fixed, along with impossible
dates and months such as `2026-13`, which the router now rejects.

## After it went public

The repository was created private, pushed, and proved green on real runners (Ubuntu with Node 22 and 24,
Windows with Node 24, and the data job) before the single irreversible step: making it public, enabling
Pages, protecting `main` and running the Pages workflow. The live address was then opened and read, page by
page, in a real browser. Doing so found, and fixed, defects that no test had:

- **The hero figure ran into the Star card** between about 900 and 1100 px (`19dd27b`); it is now sized by
  its own column with a container query.
- **A GitHub Pages `503` could blank the page** (`3e5c2a5`): data requests now retry, and a script that fails
  to arrive reloads the page once or twice and then says so in plain words instead of looping.
- **The integrity facts card spilled on a phone** (`1a677f1`).
- **Two path tests failed only on Linux** (`2642031`): path rules now follow the platform asked about, and the
  runner image is pinned so a new default cannot change the result.

## Rendered in states the real season does not have

The real data only shows what has happened so far, so the dashboard was also drawn from small seasons built
with the project's own freeze code (`test/helpers/fixture-site.mjs`): no day at all, one night, a gap, a day
frozen partial, a day with an unverified account, a quiet day, the 25-hour day when the clocks go back and the
23-hour day when they go forward. Every page of each was drawn and audited, then opened in headless Chrome at
390, 768 and 1280 px in both themes, and screenshots were looked at. That found:

- **An empty season crashed three pages** into a generic error card. It is now one explanation (when the
  season begins, when the first night is, who takes part), and the footer no longer claims a freeze.
- **Partial and unverified days were not explained anywhere.** The day page now says which account, why, and
  links to that account's summary; the calendar marks the day.
- **Counts of one read wrong** ("1 closes", "1 frozen days", "1 days with trades", "1 losses"). All the page's
  wording now follows the count. Days that are already sealed keep their words, because their files are
  hashed; the page rewords such phrases ("3 wins, 1 losses", "needs 1 active days") in the Readable view and
  the standings notes while the Raw view stays exact, and the generators were fixed for the days still to
  come (the written reports under `stars/` were rebuilt).
- **With one day of trades, the "worst day" was the best day.** It now says it needs a second day.
- **The 25-hour and 23-hour days gave no hint** why the chart has the hours it has; a note says so, and a test
  pins that the repeated hour is one column holding both halves and that no trade is lost.
- **Accessibility and preferences** were checked in the browser: every control has an accessible name, and
  reduced motion, reduced transparency and forced colours each change what they should.

These states are tests (`test/site-states.test.mjs`, and the browser checks in `test/site-browser.test.mjs`),
so they stay right.

## The night, rehearsed once for real

The nightly job had only ever met a fake harness, so on 2026-10-23 it was run end to end against the live one,
in a throwaway copy (the recipe is in [`OPERATIONS.md`](OPERATIONS.md#rehearsing-the-night)): a clone with
2026-10-22 un-frozen, a temporary remote, and a private state folder holding nothing but the harness settings.
The Hermes shim was started the way a scheduler would, with no session variables and only the system folders
on `PATH`.

- It found Node and Git on its own, read the live harness (about six seconds for all eight accounts), froze the
  day, committed (only additions under the frozen folder, plus the rewritten derived files), pushed, and ended
  with `{"wakeAgent":false,"outcome":"frozen",...}`.
- **The money matched the sealed day, which came from the close ledgers, to the cent:** all eight accounts,
  224 closes, desk +8,173.58. `trades.json` and `trades.csv` were byte-identical for every account. What
  differed was only what should: the source (`ledger` became `both`), the kind (a catch-up, because it was
  frozen more than six hours after the day ended), the balance check (`null`, since a first read has no earlier balance to compare with),
  and the entry hour of three trades that the ledger had no entry time for and the live harness did.
- A second run found nothing due and stayed asleep; a wake drill woke the agent and removed its file;
  `verify` and `rank --check` passed on the copy. The real repository and the real state folder were not touched.

What the rehearsal did not cover was Hermes itself and a push to GitHub from the scheduler's account. The first
is covered by the next section; the second is covered the first time the real job pushes.

## Wired into Hermes

Later the same day, with the owner's go-ahead, the job was created in Hermes from
[`deploy/hermes/HERMES-SETUP.md`](../deploy/hermes/HERMES-SETUP.md): `maeh-showcase-nightly`, `0 1 * * *`, the
shim installed byte for byte, the repository's skill trusted, results delivered to the same targets as the
owner's other status job. `hermes cron doctor` found no issues. Hermes's own scheduler then ran the job once,
with nothing due: its record read "Script gate returned `wakeAgent=false` - agent skipped" (no model call, no
message), the job's last-run record said `noop`, and the repository was untouched. The first real night is
01:00 on 2026-10-24, which freezes 2026-10-23. The wake and failure drills (section 7 of the setup guide) have
not been run, and Hermes's `timezone` was left unset (the settle guard makes a one-hour drift harmless).

A wake drill followed, with the owner's agreement, because the first real night falls on a Saturday, a
health-check day, and would otherwise have been the first time the agent woke, unattended. The script's gate
woke the agent; it read the skill and its runbook from the working folder, ran only read-only checks
(`nightly --status`, `verify --all`, the CI and Pages status, the scheduler), reported in a few short lines,
and changed nothing: the tree hashes of `results/` and `stars/` and the commit were the same afterwards, and the
`force-wake` file had been removed. The drill also found a defect in the setup: **a scheduled job cannot load a
repository's skill by name**, so the report opened with "Skill(s) not found: maeh-showcase" (the agent coped by
opening the file itself). The job no longer names a skill and its prompt points at the skill file instead; the
setup guide and its test say so.

## The first real night

Hermes started the job on time at 01:00 on 2026-10-24. The harness was in its quarter-hour self-refresh, so the
script waited (a few short waits, about three minutes in all), then froze 2026-10-23 with 8 of 8 account-days clean,
committed and pushed. Because it was a Saturday the gate woke the agent, which ran the health check, found the
data sound, and reported within twelve minutes that **CI and Pages had failed**: six site tests had the season's
size written into them ("16 days"), so the new day broke the build and the dashboard stayed on the 22nd. The
data and the chain were never affected (the frozen-data job passed); only the public page was stale until the
tests were fixed.

- **The tests now work out what they expect from the data.** Only the first sixteen days, which were sealed from
  the ledgers and can never change, are named.
- **The same mistake was hunted down before it could recur.** The real season was copied and grown to 91 days
  with synthetic nights (through 5 January 2027, so across the month, year and ISO week 53 changes, with partial
  and unverified days, a wholly quiet Sunday and the 25-hour day) and the whole suite and the real-browser tests
  were run on it. It found one more time bomb: a test that used 2026-12-01 as "a day that is not frozen", which
  would have turned red on 2 December. It now uses the day before the season began, which can never be frozen.
- The nightly's own behaviour on the real night matched the rehearsal: the wait for a quiet harness, the commit
  of only new files, the push, the balance anchors saved for the next night's check, and the agent woken once,
  with no "skill not found" notice now that the job points at the skill file.

## Verification

```
node scripts/verify.mjs --all       OK: <n> day(s)
node scripts/rank.mjs --check       OK: <n> day(s); derived files match a rebuild
node scripts/verify.mjs --history   OK: every blob in history scanned, none secret-shaped
node --test "test/**/*.test.mjs"    all tests pass (also in a clean git environment)
MAEH_BROWSER_TESTS=1 node --test test/site-browser.test.mjs    real-browser checks (opt-in, one CI leg)
```

## Still to do

1. The failure drill in the setup guide (section 7) has not been run; it needs a deliberately broken Node path in
   Hermes's environment, so it waits for the owner. The wake drill has been run.
2. Firefox and Safari have not been tried (neither was available where this was built). The real-browser
   checks ran in Chrome, locally and on the CI runner, and once by hand in Edge (`MAEH_CHROME` points the test
   driver at another Chromium-based browser); all six passed in each.
