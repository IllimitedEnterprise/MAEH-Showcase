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
  hashed; the page rewords one sealed phrase ("needs 1 active days") as it shows it, and the generators were
  fixed for the days still to come (the written reports under `stars/` were rebuilt).
- **With one day of trades, the "worst day" was the best day.** It now says it needs a second day.
- **The 25-hour and 23-hour days gave no hint** why the chart has the hours it has; a note says so, and a test
  pins that the repeated hour is one column holding both halves and that no trade is lost.
- **Accessibility and preferences** were checked in the browser: every control has an accessible name, and
  reduced motion, reduced transparency and forced colours each change what they should.

These states are tests (`test/site-states.test.mjs`, and the browser checks in `test/site-browser.test.mjs`),
so they stay right.

## Verification

```
node scripts/verify.mjs --all       OK: 16 day(s)
node scripts/rank.mjs --check       OK: 16 day(s); derived files match a rebuild
node scripts/verify.mjs --history   OK: every blob in history scanned, none secret-shaped
node --test "test/**/*.test.mjs"    all tests pass (also in a clean git environment)
MAEH_BROWSER_TESTS=1 node --test test/site-browser.test.mjs    real-browser checks (opt-in, one CI leg)
```

## Still to do

1. Wire the nightly job into Hermes from [`deploy/hermes/HERMES-SETUP.md`](../deploy/hermes/HERMES-SETUP.md).
   Until then nothing freezes new days on its own; the first night to freeze is 2026-10-23, at 01:00 on the 24th.
2. Firefox and Safari have not been tried; the browser checks use Chrome.
