# Fonts

The dashboard serves its own fonts: no request ever leaves for a font host, and the page's
Content-Security-Policy would block one if it tried (`font-src 'self'`).

Both families are free software under the SIL Open Font License 1.1. The files are exactly what
Google Fonts serves for the Latin subset, saved as downloaded: **not modified, not renamed in any
way that changes the font, not subset or converted by this project.** Each family's licence text sits
in `LICENSES/` next to this file and travels with the files.

| Family | Used for | File | Axes | Version | Size | SHA-256 |
|---|---|---|---|---|---|---|
| Bricolage Grotesque | every heading, label and figure | `BricolageGrotesque-latin-VF.woff2` | `wght` 200 to 800 | Google Fonts v9 | 41,344 B | `a97804dc9fbe5fc972a08018c5eda4dab7ef2346f64c57e61419d05e6de4ea1c` |
| JetBrains Mono | table columns, axis ticks, code and hashes | `JetBrainsMono-latin-VF.woff2` | `wght` 400 to 800 | Google Fonts v24 | 31,432 B | `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be` |

## Where they came from

Downloaded on 2026-10-23 from the Google Fonts CDN, the `latin` unicode-range files of each family's
variable font:

- `https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9H6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiawA1Xp.woff2`
- `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2`

Upstream projects:

- Bricolage Grotesque, Copyright 2022 The Bricolage Grotesque Project Authors, https://github.com/ateliertriay/bricolage
- JetBrains Mono, Copyright 2020 The JetBrains Mono Project Authors, https://github.com/JetBrains/JetBrainsMono

## Why these two

- **Bricolage Grotesque** is a grotesque sans with real character at large sizes, which is what the
  big figures and titles need, and it stays readable at body size. One family does all the UI text,
  the hero figure included, so a number never looks like decoration.
- **JetBrains Mono** has fixed-width digits, so columns of money line up. Tabular figures are used
  only where numbers stack in columns (tables, chart axes); large standalone figures use the
  proportional digits of Bricolage Grotesque.

The Latin subset covers the minus sign (U+2212), the en dash (U+2013), the euro sign and the
punctuation the site uses. Arrows and the crown are drawn as SVG, not typed as characters, so no
glyph is ever missing.

## Checking them

`test/site-fonts.test.mjs` hashes both files and compares them with the table above, so a changed
font cannot slip in unnoticed. To verify by hand:

```sh
node -e "for (const f of ['BricolageGrotesque','JetBrainsMono']) console.log(f, require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('site/assets/fonts/'+f+'-latin-VF.woff2')).digest('hex'))"
```
