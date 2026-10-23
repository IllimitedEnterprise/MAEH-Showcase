# Dashboard design

The dashboard is a static site with no framework, no dependencies and no build step for the page itself.
This page explains the look, the colour rules, how the charts work, and how the code is organised and
tested. The aim throughout: **bold and beautiful, and never at the cost of a number being misread.**

## Look: Aurora glass

- **Canvas.** A deep navy-violet page with four soft colour washes (teal, violet, magenta, blue) in its
  corners. The washes are static on purpose: glass cards blur whatever is behind them, and a moving
  background would make every card re-blur every frame.
- **Glass.** Cards are translucent with a hairline edge and a faint top highlight, blurred over the
  aurora. On a phone, or with `prefers-reduced-transparency`, or where `backdrop-filter` is missing, a
  card is a nearly solid panel instead, so the page costs less and stays readable.
- **Figures.** Big, tight, proportional numerals. The one **hero figure** on each page is at least 48 px
  and set in the same family as the rest of the page, so a number never looks like decoration. Columns of
  numbers (tables, axes, hashes) use JetBrains Mono, whose digits are fixed-width, so they line up.
- **Dark first, light included.** Dark is the house look; the toggle in the header switches to light and
  remembers the choice. Both are checked for contrast (below).

Fonts are bundled and licensed: [`site/assets/fonts/FONTS.md`](../site/assets/fonts/FONTS.md).

## Colour, and what it is allowed to mean

| Role | Rule |
|---|---|
| **Gain and loss** | a signed figure with a **▲ or ▼** and a true minus (U+2212); green and red only repeat what the sign and arrow already say. Zero is a plain `0.00`; a figure that does not exist is a muted en dash, never coloured, so "no data" cannot look like a win or a loss. |
| **An account** | each account has one colour from the validated palette, in the order of `config/accounts.json`, and keeps it on every page: the swatch, its card, its line, its columns. Colour follows the account, never its rank. |
| **The desk** | the whole desk, as opposed to an account, is drawn in ink (lines) or the brand violet (columns), never in an account's colour. |
| **Gold** | a Star. Always with a crown icon and the word "Star" for assistive technology. |
| **Heat** | the calendar's squares: green deeper for a bigger gain, red deeper for a bigger loss, a neutral for none. Every cell also prints its figure, so colour is never the only signal. |

### The series palette

The eight account colours are the eight categorical steps of the dataviz method, in its fixed order, one
set per theme, and were run through its validator against the real chart surface:

| Mode | Surface | Lightness band | Chroma | Neighbours, colour-blind separation | Neighbours, normal vision | Contrast ≥ 3:1 |
|---|---|---|---|---|---|---|
| Dark | `#10132f` | pass | pass | worst pair ΔE 8.4 (target 8) | worst pair ΔE 19.3 (floor 15) | all eight |
| Light | `#fafaff` | pass | pass | worst pair ΔE 9.1 | worst pair ΔE 19.6 | five of eight; aqua, yellow and magenta fall below, so every chart has a legend and a table twin |

`test/site-contrast.test.mjs` keeps the palette exactly as validated and fails if it drifts. Because the
eight colours were not changed to suit the look, the aurora accents (teal, violet, magenta, blue) are used
only for decoration, the brand gradient, and single-series marks, never to identify an account.

### Contrast is tested, not eyeballed

The same test reads the real `tokens.css` and checks every text colour against every surface it can land
on: the page, a card, the hero, a phone's solid card, a tooltip, the chart plate, each of them over the
aurora at its **brightest** point, plus text on a gain or loss badge, a heat cell and the Star card.
Text needs 4.5:1 (ink 7:1), marks 3:1. Several colours failed at first and were corrected; the test is what
keeps them corrected.

## Charts

Hand-drawn SVG, built by pure functions so they can be tested without a browser.

- **Marks.** Lines are 2 px with round joins. End dots are at least 8 px with a 2 px ring in the surface
  colour. Areas are a wash, never a block (the desk curve is tinted green above zero and red below).
  Columns are at most 24 px thick, rounded at the data end and square at the baseline, with a 2 px gap
  between neighbours. Gridlines are solid hairlines.
- **The axis is the calendar.** A weekend with no closes is a visible gap, a **quiet day** (frozen, no
  closes) is a short tick on the baseline, and a day that was never frozen is absent. Three different
  things look different.
- **Labels.** Text uses text colours, never a series colour; identity comes from the coloured mark beside
  it. Only the end of a line, and the best and worst column, carry a value; the tooltip and the table carry
  the rest.
- **One tooltip, every series.** A hairline snaps to the nearest day and one tooltip lists everything
  there, value first. It enhances; it is never the only way to read a value.
- **Keyboard and touch.** A chart is a focusable group: the arrow keys, Home, End and Escape move the
  cursor, and the value is announced. Touch shows the cursor and keeps it until the next tap elsewhere.
- **A table twin for every chart** behind a Chart/Table switch, with every value the picture shows.
- **Tick labels** are a whole number of days apart, counted back from the newest day so that day is
  always labelled.
- Under `forced-colors`, series fall back to system colours; the legend and table carry identity.

## Pages

| Route | Page |
|---|---|
| `#/` | Season: hero figure, the Star of the day, the cumulative curve, daily columns, the eight account cards, the account race, recent days, the Star tally |
| `#/calendar[/YYYY-MM]` | A month heat grid, Monday first, with ISO week totals and week crowns |
| `#/day/DATE[/file/PATH]` | One frozen day, and a file browser with a readable and a raw view of every file and an in-browser hash check |
| `#/account/KEY` | One account's whole record |
| `#/stars[/day|week|month|all]` | Standings, finished periods, the tally and the rules |
| `#/integrity` | The chain, a button that checks it in the browser, and how to check it yourself |

Routes are hash-based so the site works on GitHub Pages with no server rules. A bad link says so
instead of showing a blank page.

### States the data can be in

| State | What the page does |
|---|---|
| No day frozen yet | Every route but the 404 shows one explanation: when the season begins, that the first night is at 01:00, and who takes part. The footer says nothing is frozen yet |
| One day | Wording follows the count ("1 frozen day"); the worst day waits for a second day with trades |
| A gap (a day never frozen) | A dashed "not frozen" cell in the calendar, listed on the integrity page; never drawn as zero |
| A day frozen partial, or an account that could not be proven complete | A note above the day names the account, says why, links to its summary, and says it is left out of the ranking; the calendar flags the day |
| A quiet day (frozen, no closes) | A tick on the line, "no closes" in the calendar, no footnote about entry hours |
| The 25-hour and 23-hour days | A badge, and a note under the entry-hours chart: the repeated hour is one column holding both halves, the missing hour has none |

A count of one takes the singular everywhere it is written. The one exception is text inside a sealed day,
which is hashed and never edited; the page rewords the single phrase that matters ("needs 1 active days").

## Responsive and accessible

- Designed at 390 px first. On a phone the navigation is a bar along the bottom edge; tables drop their
  optional columns; charts are redrawn at the width they are given, so type never scales down.
- Semantic landmarks, one `h1` per page, a skip link, visible focus rings, real buttons and links, labels
  for every control and chart, a polite live region that announces page changes and chart steps.
- `prefers-reduced-motion` removes every transition; `prefers-reduced-transparency` and `forced-colors`
  have their own fallbacks; print drops the chrome.

## Security

The page runs under a strict Content-Security-Policy set in the page itself: `default-src 'none'`, scripts,
styles, fonts and requests from the page's own origin only, no inline script, no inline style, no framing
or form targets. Because inline styles are blocked, values that only exist at run time (a bar's width) are
written as `data-style="--w:37%"` and applied through the CSSOM, which the policy allows; the parser accepts
only custom properties with plain values.

Every string from a data file is **escaped by default**: markup is built by a tagged template that escapes
every interpolated value and trusts only its own nested templates. The Markdown renderer escapes first and
allows only relative, anchor and `https` links. The raw file viewer escapes, then colours. A test scans all
site code for `eval`, `Function`, `document.write`, inline handlers, remote URLs, and any `innerHTML`
assignment outside the two modules that own it.

## How it is built

```
site/
  index.html  theme-boot.js        the shell and the pre-paint theme
  css/ tokens base components charts
  js/app.mjs                       boot, router, the few interactions
  js/lib/    html dom data model fmt scale router markdown highlight csv theme site
  js/charts/ geometry draw interact     numbers -> coordinates -> SVG text -> pointer layer
  js/views/  season calendar day files account stars integrity empty
  js/ui.mjs                        cards, tiles, badges, notices, tables, standings
```

Data flows one way: the loader fetches the repository's own JSON (a build id is appended so a fresh deploy
is never hidden by a ten-minute CDN copy), `model.mjs` answers questions about it, a view turns that into a
string of markup, `mount()` puts it on the page, and `after()` attaches the charts. Nothing is cached in
the browser between visits except the theme choice.

There is no bundler: the page loads about thirty small ES modules over HTTP/2. If that ever matters, a
single-file bundle can be added to `scripts/build-site.mjs` without touching the source.

### When the host hiccups

A static host now and then answers one file with a 503, and a page made of many small scripts feels that
more than most. Two things deal with it, both exercised by injecting the failure into a real browser:

- **Data requests** are retried twice, after 250 and 800 ms, for the statuses a host uses for a hiccup (408,
  425, 429 and the 5xx family) and for a dropped connection. A 404 is an answer and is never retried.
- **The scripts** are started by a small classic script, `boot.js`. If the module graph fails to arrive it
  reloads the page, at most twice (counted in `sessionStorage`, so there can be no loop), and then says in
  plain words what happened, with a Reload button. A failed script is remembered by the browser for the life
  of a page, which is why a fresh load is the only retry that works. With one injected 503 the visitor sees
  the page after a brief blink; with a permanent one, the message after three loads.

## How it is tested

| Test file | What it proves |
|---|---|
| `site-lib`, `site-core` | formatting, scales, routes, the Markdown renderer, the loader, the model, every chart builder |
| `site-views` | **every route and every file of every frozen day** is drawn from the real committed data and audited: balanced markup, unique ids, resolvable links, no `NaN`, `null` or `undefined`, only escaped text; the hash and chain checkers catch a tampered file and a broken link |
| `site-states` | small seasons built with the project's own freeze code (`test/helpers/fixture-site.mjs`): none, one night, a gap, a partial day, an unverified account, a quiet day, the 25-hour and 23-hour days. Every page of each is drawn and audited like the real ones, plus the wording of a count of one, the notice, the calendar flag, and the hours chart on a day with a repeated or missing hour |
| `site-contrast` | colour contrast on every surface, and the validated palette unchanged |
| `site-csp` | the policy, forbidden APIs, where `innerHTML` may be set, every import and class resolves |
| `site-fonts` | the bundled fonts are the recorded files |
| `site-server` | the preview serves only the page and the data folders; path traversal cannot escape; the Pages artifact holds nothing else |
| `site-hostile` | the real files served with script tags, event handlers, `javascript:` links and image payloads swapped into every label, symbol and Markdown file: every route is drawn and nothing comes out as markup; an account called `__proto__` is just not found |
| `workflows` | every action pinned and vetted, the token read-only, nothing user-controlled reaches a shell |
| `site-browser` | **a real Chrome or Edge** draws the pages at nine widths (390 to 1440 px) in both themes and finds no sideways scroll, no box overflowing itself, no hero figure running into the Star card, no console message and no failed request; a 503 injected into one script is survived once and given up on cleanly when permanent; the chain and per-day verifiers, deep links, keyboard stepping and the theme switch work; the fixture seasons above are drawn at phone, tablet and desktop widths; every control has an accessible name; reduced motion, reduced transparency and forced colours each change what they should. Opt-in (`MAEH_BROWSER_TESTS=1`) so `node --test` stays instant; CI runs it on one Linux leg |

Two layout bugs, the hero figure running into the Star card between about 900 and 1100 px and a commit hash
spilling out of its card on a phone, were found only by probing more widths than the first inspection used.
They are exactly what `site-browser` now keeps from coming back.
