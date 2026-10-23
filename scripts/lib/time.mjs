/* Calendar days in a named IANA zone, with no dependency beyond Intl.
 *
 * A trade belongs to the local calendar date of the instant it CLOSED, and a day is
 * half-open: [first second of the date, first second of the next). This is the rule the
 * harness's own performance section uses (the offset is read per instant, never fixed),
 * so a frozen day and the desk's day always hold the same trades. A day is 24 h long
 * except where the zone changes its clock: Europe/Berlin has one 25 h day each autumn
 * and one 23 h day each spring, and every function here is written for that.
 *
 * Seconds are whole epoch seconds (UTC). Dates are 'YYYY-MM-DD' strings. */

const formatters = new Map();

function formatterFor(zone) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    // hourCycle 'h23', never `hour12: false`: the latter can print "24" at midnight.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/* "local" -> the machine's own IANA zone; anything else must be a valid IANA id. */
export function resolveZone(setting) {
  const zone = !setting || setting === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : setting;
  formatterFor(zone); // throws RangeError for an unknown zone
  return zone;
}

const pad = (value, width = 2) => String(value).padStart(width, "0");
export const formatDate = (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ""));
  if (!match) throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(text)}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day)
    throw new RangeError(`not a real calendar date: ${text}`);
  return { year, month, day };
}

export function addDays(date, count) {
  const { year, month, day } = parseDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day + count));
  return formatDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/* Whole days from `from` to `to` (negative if `to` is earlier). Pure calendar arithmetic. */
export function daysBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/* 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(sec, zone) {
  const parts = formatterFor(zone).formatToParts(new Date(Math.floor(sec) * 1000));
  const read = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: read("year"), month: read("month"), day: read("day"),
    hour: read("hour"), minute: read("minute"), second: read("second") };
}

/* The zone's offset from UTC, in seconds, at an instant (positive = ahead of UTC). */
export function offsetSec(zone, sec) {
  const whole = Math.floor(sec);
  const p = localParts(whole, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - whole;
}

export function localDate(sec, zone) {
  const p = localParts(sec, zone);
  return formatDate(p.year, p.month, p.day);
}

export function formatOffset(seconds) {
  const sign = seconds < 0 ? "-" : "+";
  const abs = Math.abs(seconds);
  return `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`;
}

/* The first second whose local date is >= `date`. The local date never runs backwards
 * across a date boundary in any real zone, so a bisection finds it. */
function firstSecondOnOrAfter(date, zone) {
  const { year, month, day } = parseDate(date);
  const base = Date.UTC(year, month - 1, day) / 1000;
  let low = base - 15 * 3600;  // every zone is at most UTC+14, so this is still the day before
  let high = base + 12 * 3600; // every zone is at least UTC-12, so this is on or after the date
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(middle, zone) >= date) high = middle;
    else low = middle;
  }
  return high;
}

/* [start, end) of a local date, with the offsets it starts and ends under. */
export function dayWindow(date, zone) {
  const startSec = firstSecondOnOrAfter(date, zone);
  const endSec = firstSecondOnOrAfter(addDays(date, 1), zone);
  const hours = (endSec - startSec) / 3600;
  if (hours < 23 || hours > 25) throw new RangeError(`unsupported day length ${hours} h for ${date} in ${zone}`);
  return {
    date, zone, startSec, endSec, hours,
    startOff: offsetSec(zone, startSec),
    endOff: offsetSec(zone, endSec),
  };
}

const isoOf = (sec) => new Date(sec * 1000).toISOString().replace(".000Z", "Z");

/* The window as it is written into a manifest. */
export function windowRecord(window) {
  return {
    startUtc: isoOf(window.startSec), endUtc: isoOf(window.endSec),
    startOff: formatOffset(window.startOff), endOff: formatOffset(window.endOff),
    hours: window.hours,
  };
}

/* One entry per clock hour in the day: a 25 h day has 25, a 23 h day has 23. Each is keyed by
 * its local label AND the offset it runs under, so the repeated 02:00 hour stays two buckets. */
export function hourBuckets(window) {
  const count = Math.ceil(window.hours);
  const buckets = [];
  for (let index = 0; index < count; index += 1) {
    const startSec = window.startSec + index * 3600;
    const p = localParts(startSec, window.zone);
    buckets.push({ h: `${pad(p.hour)}:${pad(p.minute)}`, off: formatOffset(offsetSec(window.zone, startSec)), startSec });
  }
  return buckets;
}

/* Index of the bucket an instant falls in, or -1 when it is outside the day. */
export function bucketIndex(window, sec) {
  if (!(sec >= window.startSec && sec < window.endSec)) return -1;
  return Math.floor((sec - window.startSec) / 3600);
}

/* ISO 8601 week of a calendar date: { year, week }, e.g. 2026-12-31 is week 53 of 2026. */
export function isoWeek(date) {
  const { year, month, day } = parseDate(date);
  const thursday = new Date(Date.UTC(year, month - 1, day));
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return { year: isoYear, week: 1 + Math.round((thursday - firstThursday) / (7 * 86_400_000)) };
}

export function isoWeekKey(date) {
  const { year, week } = isoWeek(date);
  return `${pad(year, 4)}-W${pad(week)}`;
}

export const monthKey = (date) => date.slice(0, 7);

export const weekMonday = (date) => addDays(date, -((weekdayOf(date) + 6) % 7));

/* The seven dates of the ISO week containing `date`, Monday first. */
export function weekDates(date) {
  const monday = weekMonday(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function monthDates(date) {
  const { year, month } = parseDate(date);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => formatDate(year, month, index + 1));
}

/* The most recent local date whose end passed at least `settleMin` minutes ago. Freezing a day
 * the instant it ends would race the last close and an hour of cron drift; the guard waits. */
export function lastSettledDate(nowSec, zone, settleMin = 30) {
  let date = addDays(localDate(nowSec, zone), -1);
  while (nowSec < dayWindow(date, zone).endSec + settleMin * 60) date = addDays(date, -1);
  return date;
}

/* Every date from the season start (or the first date asked for) up to the last settled day
 * that has no frozen folder yet, oldest first. */
export function pendingDays({ nowSec, zone, frozen, settleMin = 30, seasonStart }) {
  const last = lastSettledDate(nowSec, zone, settleMin);
  const have = frozen instanceof Set ? frozen : new Set(frozen);
  const pending = [];
  for (let date = seasonStart; date <= last; date = addDays(date, 1)) {
    if (!have.has(date)) pending.push(date);
  }
  return pending;
}
