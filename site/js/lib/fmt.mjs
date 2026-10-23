/* Formatting, in one place so every figure on every page is written the same way.
 *
 * The money vocabulary: a gain is signed + and goes green with an up marker, a loss is signed
 * with a true minus (U+2212) and goes red with a down marker, an exact zero is a plain "0.00"
 * in the neutral colour, and a value that does not exist is an en dash in a muted colour. An
 * absent value is never coloured: "no data" must not look like a win or a loss.
 *
 * Dates are calendar dates written as YYYY-MM-DD and are formatted in UTC, so the page reads
 * the same in every viewer's time zone. */

export const MINUS = "−";
export const DASH = "–";

const money2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const number1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const number3 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });

const absent = (value) => value === null || value === undefined || Number.isNaN(value);

export function money(value, { signed = true } = {}) {
  if (absent(value)) return DASH;
  const body = money2.format(Math.abs(value));
  if (value === 0) return body;
  if (value > 0) return signed ? `+${body}` : body;
  return `${MINUS}${body}`;
}

/* gain | loss | flat | none */
export const tone = (value) => (absent(value) ? "none" : value > 0 ? "gain" : value < 0 ? "loss" : "flat");

export const int = (value) => (absent(value) ? DASH : number0.format(value));
export const two = (value) => (absent(value) ? DASH : money2.format(value));
export const one = (value) => (absent(value) ? DASH : number1.format(value));
export const num = (value) => (absent(value) ? DASH : number3.format(value));

/* An R multiple: up to three decimals as stored, signed, true minus. */
export function rMultiple(value) {
  if (absent(value)) return DASH;
  const body = number3.format(Math.abs(value));
  return value === 0 ? body : `${value < 0 ? MINUS : "+"}${body}`;
}

export function bytes(value) {
  if (absent(value)) return DASH;
  if (value < 1024) return `${int(value)} B`;
  return `${number1.format(value / 1024)} KB`;
}

export function pct(value, { signed = false, digits = 1 } = {}) {
  if (absent(value)) return DASH;
  const body = new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  if (value === 0) return `${body}%`;
  return `${value < 0 ? MINUS : signed ? "+" : ""}${body}%`;
}

/* A short figure for an axis or a small cell: 1500 -> 1.5k, -2300000 -> -2.3m, 327.8 -> 328. */
export function compact(value) {
  if (absent(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}m`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}k`;
  if (abs >= 10) return `${sign}${Math.round(abs)}`;
  return `${sign}${trim(abs)}`;
}
const trim = (value) => String(Number(value.toFixed(1)));

export const profitFactor = (value, grossWin = 0) => (value === null || value === undefined ? (grossWin > 0 ? "no losses" : DASH) : money2.format(value));

/* Names are spelled out here rather than taken from Intl: punctuation such as "Thursday, 22 October"
 * differs between ICU versions and browsers, and these labels must read the same everywhere. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parts = (date) => {
  const [year, month, day] = String(date).split("-").map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
};

export const longDate = (date) => { const p = parts(date); return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`; };
export const mediumDate = (date) => { const p = parts(date); return `${WEEKDAYS[p.weekday].slice(0, 3)} ${p.day} ${MONTHS[p.month - 1].slice(0, 3)} ${p.year}`; };
export const shortDate = (date) => { const p = parts(date); return `${p.day} ${MONTHS[p.month - 1].slice(0, 3)}`; };
export const weekday = (date) => WEEKDAYS[parts(date).weekday].slice(0, 3);
export const monthTitle = (month) => { const p = parts(`${month}-01`); return `${MONTHS[p.month - 1]} ${p.year}`; };
export const dayOfMonth = (date) => Number(date.slice(8, 10));

export const hashShort = (hash, length = 12) => (hash ? String(hash).slice(0, length) : DASH);
export const plural = (count, one_, many) => `${int(count)} ${count === 1 ? one_ : many ?? `${one_}s`}`;

/* Sealed text is hashed and never edited, so a day frozen earlier can say "3 wins, 1 losses" or "needs 1 active
 * days". The page words a count of one right wherever it shows such text as prose; the raw file is untouched. */
export const tidyCounts = (text) => String(text).replace(/(^|[^\w.,])1 (?:(active day|close|trade|day|win)s|(loss)es)\b/g, (_match, lead, noun, loss) => `${lead}1 ${noun ?? loss}`);

/* "2026-W43" -> "Week 43"; "2026-10" -> "October 2026". */
export function periodLabel(kind, period) {
  if (kind === "week") return `Week ${Number(period.slice(6))}${period.slice(0, 4) ? `, ${period.slice(0, 4)}` : ""}`;
  if (kind === "month") return monthTitle(period);
  return longDate(period);
}

/* Stars, drawn as text for assistive technology; the page draws the icon separately. */
export const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;

export const KIND_LABEL = { nightly: "Frozen overnight", catchup: "Caught up", backfilled: "Backfilled" };
export const STATUS_LABEL = { complete: "Complete", partial: "Partial", ok: "OK", quiet: "No trades", unverified: "Unverified", prefunding: "Not funded yet" };
