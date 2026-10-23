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

## Verification, as of the sixteenth day

```
node scripts/verify.mjs --all       OK: 16 day(s)
node scripts/rank.mjs --check       OK: 16 day(s); derived files match a rebuild
node scripts/verify.mjs --history   OK: every blob in history scanned, none secret-shaped
node --test "test/**/*.test.mjs"    all tests pass (also in a clean git environment)
```

## Still to do before the site is public

1. A review of the whole tree for the things a second pair of eyes finds.
2. Create the repository **private**, push, and prove CI green on real runners.
3. Make it public, enable Pages, protect `main`, run the Pages workflow, and inspect the live address.
4. Tag the chain tip.
5. Wire the nightly job into Hermes from [`deploy/hermes/HERMES-SETUP.md`](../deploy/hermes/HERMES-SETUP.md).
