# Star rules

Rules version **v1**. Days are sealed under the rules in force on the day, so changing these never rewrites a past crown.

Every account here is a demo account. A score describes what happened over a period under these rules; it is not advice and not a measure of quality or safety.

## The score

Four marks, each between 0 and 1, are blended into a raw figure out of 100, then pulled toward 50 by a credibility factor so that a few lucky trades cannot outrank a long solid record.

| Mark | What it measures | Full mark | No mark |
|---|---|---|---|
| Return (40%) | net result as a share of funding; zero earns half a mark | +retHalf % | -retHalf % |
| Profit factor (20%) | gross win over gross loss, on a log scale; 1 earns half | 4 (or no losses) | 0.25 or below |
| Drawdown (25%) | the deepest fall of the running result, as a share of funding | none | ddZero % |
| Win rate (15%) | wins over wins plus losses, breakevens excluded | 70% | 30% |

`score = 50 + (raw - 50) x n / (n + k)`, where n is the number of closes and k depends on the period.

## Periods

| Period | retHalf % | ddZero % | k | Closes needed | Active days needed |
|---|---:|---:|---:|---:|---:|
| day | 3 | 5 | 10 | 3 | 1 |
| week | 6 | 10 | 40 | 10 | 2 |
| month | 12 | 20 | 120 | 30 | 5 |

A week is the ISO week, Monday to Sunday, in the season's time zone. A month is the calendar month.

## Who can be ranked

An account is ranked for a period only if it was funded by the first day of the period, has a funding record, has enough closes and active days, and every day of the period was complete and verified. Anyone else still appears in the table, with the reason.

## The crown

The crown goes to rank 1, and only if that account's net result is positive; otherwise there is no Star. Ties are broken by net result, then profit factor, then lower drawdown, then more closes, then the account key.

Week and month crowns are awarded only when every day of the period is frozen. Until then the page shows who is leading, which is not a crown. A period that began before the season did is marked as partial.

## Points

A day crown is worth 1, a week crown 5, a month crown 20. A streak is consecutive crowned days won by the same account; a day with no crown does not break it, a different winner does.
