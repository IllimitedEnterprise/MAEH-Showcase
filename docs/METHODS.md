# Methods

How every number here is produced, and what the record does and does not prove. Everything on this
page is enforced by code and checked by tests; where a rule lives is named in brackets.

All accounts are **demo accounts** trading simulated money. Nothing here is advice.

## 1. The day

A **day** is a calendar date in the season's time zone, **Europe/Berlin**, and a trade belongs to the
day on which it **closed**. The rule is the half-open interval from the first second of the local date
up to, but not including, the first second of the next one [`scripts/lib/time.mjs`].

- The zone is a real IANA zone, so daylight saving is handled by the date arithmetic, not by a fixed
  offset. **Sunday 2026-10-25 is a 25-hour day and Sunday 2027-03-28 is a 23-hour day.** Each manifest
  records the exact UTC window (`startUtc`, `endUtc`), the offsets at both ends, and the length in
  hours, so a reader never has to take the rule on trust.
- A trade that closes at 00:00:00 belongs to the new day; one closing at 23:59:59 belongs to the old.
- A day is frozen only after it has had time to settle: the job waits until 30 minutes past its end.

## 2. Where the figures come from

The harness exposes two views of an account's closed trades, and the job uses both.

| Source | What it is | When it is trusted |
|---|---|---|
| **Live read** | the harness's own `progress` report for the account | for a recent day; it holds only the newest 500 closes, so it cannot describe an old one |
| **Close ledger** | the harness's append-only copy of every close it has seen | when a live read succeeded in the same run, or when the file was written after the day ended |

Each close carries a symbol, side, net result, close time and open time. **R** (the result in units of
the risk taken) comes from the harness's execution journal and is published only where a close can be
joined to it; it is never filled in with a zero.

Two checks guard against a read that is incomplete:

- **Balance chain.** The job keeps, privately, each account's balance at the last capture. The new
  balance minus the old must equal the sum of the closes in between (within one cent). If it does not,
  the account-day is marked **partial** and the gap is recorded. This also catches a deposit.
- **Backfill gate.** For the days frozen on first publication, the funding anchor plus the sum of every
  ledger close must equal the account's live balance. All eight accounts matched to the cent. An
  account that did not would have its backfilled days marked **unverified**: shown, badged, and kept
  out of every crown.

The first sixteen days (2026-10-07 to 2026-10-22) were frozen from the close ledgers in one run on
2026-10-23 and carry the kind **backfilled**. From then on a day is frozen the night after it happens.

## 3. What each figure means

These are defined exactly as the harness's own performance section defines them; parity is pinned by
tests against figures the harness itself produced [`test/parity.test.mjs`].

| Figure | Definition |
|---|---|
| Net | the sum of the closes' net results, as the harness reports each one, in cents |
| Closes | number of positions closed in the day |
| Win rate | wins ÷ (wins + losses), one decimal; breakevens are left out |
| Profit factor | gross win ÷ gross loss, two decimals; none when nothing was lost |
| Longest runs | the longest run of wins and of losses in close order; a breakeven ends a run |
| Max drawdown | the deepest fall of the running net result, trade by trade, from a peak that starts at zero |
| Return on funding | net ÷ funding, three decimals; funding is the account's recorded starting balance |
| R | the sum of R over closes that carry one, and how many do |
| Symbols | closes and net result per instrument |

Money is held as integer cents everywhere and written with two decimals.

### Entry hours

For the trades that closed on the day, how many were **opened** in each local hour. Counts only: no
opening or closing times are published. `earlier` counts trades opened before the day began, and
`unknown` those with no recorded entry; the buckets, `earlier` and `unknown` always add up to the day's
closes. On a 25- or 23-hour day the buckets are keyed by the hour and its UTC offset, so the repeated
or skipped hour is shown as it happened.

## 4. Statuses

| Status | Meaning |
|---|---|
| `complete` (day) | every account was read cleanly |
| `partial` (day) | at least one account could not be read completely; the reason is written inside the day |
| `ok` (account-day) | read cleanly, with trades |
| `quiet` | read cleanly, no closes |
| `partial` | the balance chain did not close, or the ledger was torn |
| `unverified` | backfilled from a ledger that did not reconcile with the account balance |
| `prefunding` | the account was not yet funded on that date |

How a day was frozen is its **kind**: `nightly` (the night after), `catchup` (frozen later because a
night was missed) or `backfilled`.

## 5. The Star score

The score answers one question: over a period, how well did an account do, **trusting it less when it
made few trades**. The constants are in [`config/rules.v1.json`](../config/rules.v1.json) and are
versioned; a day is sealed under the rules in force, so changing them can never rewrite a past crown.

Four marks, each between 0 and 1:

| Mark | Formula | Weight |
|---|---|---|
| Return | `clamp(0.5 + 0.5 × return% ÷ retHalf)`: zero earns half, `+retHalf %` a full mark | 40 % |
| Profit factor | `clamp(0.5 + log₄(PF) ÷ 2)`: PF 1 earns half, 4 a full mark, 0.25 none; no losses earns a full mark | 20 % |
| Drawdown | `1 − clamp(drawdown% ÷ ddZero)`: none earns a full mark, `ddZero %` none | 25 % |
| Win rate | `clamp((win rate − 30) ÷ 40)`: 30 % earns none, 70 % a full mark; no decided trades earns half | 15 % |

`raw = 100 × (0.40·ret + 0.20·pf + 0.25·dd + 0.15·win)`, then **`score = 50 + (raw − 50) × n ÷ (n + k)`**,
where `n` is the number of closes. With few closes the score stays near 50, so three lucky trades
cannot outrank sixty solid ones.

| Period | retHalf | ddZero | k | Closes needed | Active days needed |
|---|---:|---:|---:|---:|---:|
| Day | 3 % | 5 % | 10 | 3 | 1 |
| Week | 6 % | 10 % | 40 | 10 | 2 |
| Month | 12 % | 20 % | 120 | 30 | 5 |

### Who can be ranked

An account is ranked for a period only if it was **funded by the period's first day**, has a funding
record, has enough closes and active days, and **every day of the period was complete and verified**.
Anyone else still appears in the table with the reason in plain words.

### Order and the crown

Ranking is by score, then net result, then profit factor (no losses is best), then **lower** drawdown,
then more closes, then the account key, so the order is total and never depends on input order. Scores
are compared as integers (hundredths). **The crown goes to rank 1, and only if that account's net
result is positive.** Otherwise the period has no Star.

### Weeks, months and the tally

A week is the ISO week (Monday to Sunday) and a month the calendar month, both in the season's zone.

- A **day** crown is computed when the day is frozen and sealed in that day's `stars.json`.
- A **week or month** crown is awarded only when every day of the period is frozen. It is derived from
  the frozen days by the same rules and rebuilt every night into [`stars/crowns.json`](../stars/crowns.json),
  so anyone can recompute it and `rank.mjs --check` fails if the file differs by a byte. Until then the
  dashboard shows who is **leading**, labelled as a standing, never as a crown.
- A period that began before the season did (the first week and month) is marked **partial** and keeps
  its crown, flagged.
- The **tally** gives 1 point for a day crown, 5 for a week and 20 for a month. The **streak** is the
  longest run of consecutive day crowns won by one account; a day with no Star neither extends nor
  breaks it, and anything else does.

## 6. Freezing, and what the chain proves

A day is built in a temporary folder, read back from the disk and verified exactly as a stranger would
verify it, and only then renamed into place in a single step. A folder that exists is never touched:
freezing a date twice is an error, not an overwrite [`scripts/lib/seal.mjs`].

Each day's manifest (`day.json`) lists the SHA-256 and size of every other file, the zone and exact UTC
window, and a link to the previous day's manifest: its sequence number, date and SHA-256. The sequence
number is **freeze order**, so a late backfill cannot break the chain. The manifest's own hash is the
SHA-256 of its bytes, and the next day carries it forward.

`node scripts/verify.mjs --all` checks, for every day: that the files are exactly the files that were
sealed (each hash and size matches, none is missing or unlisted); the day's window against the zone's
rules (a changed tz database is a warning, not a failure); every account's summary and hour counts
recomputed from its own trade file; the desk totals recomputed from the summaries; the Star standings and
the crown re-derived from the summaries and the rules; and the privacy scan. Across days it checks the
sequence and every link back, and that the derived files, rebuilt in a temporary folder, match byte for
byte. In CI it also confirms that, since the previous push, `results/` only gained files.

Mechanical guards, not just good intentions:

- a **pre-commit hook** refuses any commit that edits or deletes a frozen file, and a **pre-push hook**
  refuses a push that rewrites history or deletes a branch or tag;
- **CI** repeats the check on every push and pull request and scans every commit ever made;
- an annotated **tag** marks the chain tip after each Sunday's freeze;
- GitHub **branch protection** blocks force-pushes and deletion of `main`.

**What this proves, and what it does not.** A hash chain kept in a repository its owner controls is
*tamper-evidence*: if any frozen byte changes after publication, anyone can see that it did, because a
hash, a link or the tip will no longer match. It cannot prove that the figures were true when they were
written; that rests on the harness and the accounts. Anyone who keeps a copy of the tip hash or a tag has
an independent witness.

## 7. Privacy

Public objects are built from an **allowlist projection** that throws on a field it does not know, and
`verify` scans every public file again for forbidden keys (ticket, login, server, id, comment, model,
stage, timeframe, volume, prices, fees, equity, floating, paths, ports, URLs) and forbidden shapes (UUIDs,
IP addresses, drive paths, e-mail addresses, ISO timestamps outside the manifest, long digit runs, secret
shapes). Account labels are published as they are. Per-trade rows carry no time of any kind.

## 8. Determinism

Files are written by Node only, as UTF-8 with LF line endings and no byte order mark, with canonical key
order. The derived files are rebuilt twice per run and must be byte-identical; `.gitattributes` marks
`results/` and `stars/` as `-text` so no checkout can change a byte.

## 9. Limits to keep in mind

- These are demo accounts over a short season; sixteen days is a small sample, and a single big day moves
  every figure.
- The composite score is a judgement: its weights and constants are a choice, published and versioned,
  not a measure of skill or safety.
- The trading terminal's deal cache is not a complete record, which is why the balance chain and the
  backfill gate exist; a mismatch is shown, never hidden.
- R is available only where the journal can be joined to a close.
- The first sixteen days are backfilled from ledgers rather than captured nightly.

## 10. Where the build differs from the first design

Small, deliberate changes, recorded so nothing is a surprise:

- `trades.json` is an object (`{ schema, date, key, trades: [...] }`), not a bare array.
- The funding figure is `funding` (in the account's currency), not `fundingEur`.
- Week and month crowns are **derived** from the frozen days rather than sealed at the time; the result is
  the same and is checked byte for byte.
- A period that began before the season is flagged `partialPeriod` instead of a `late` marker.
