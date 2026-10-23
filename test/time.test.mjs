import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, bucketIndex, dayWindow, daysBetween, hourBuckets, isoWeekKey, lastSettledDate, localDate,
  monthDates, offsetSec, parseDate, pendingDays, resolveZone, weekDates, weekdayOf, windowRecord,
} from "../scripts/lib/time.mjs";

const BERLIN = "Europe/Berlin";
const iso = (sec) => new Date(sec * 1000).toISOString();
const at = (text) => Date.parse(text) / 1000;

test("a normal day is 24 hours and starts at local midnight", () => {
  const window = dayWindow("2026-10-22", BERLIN);
  assert.equal(window.hours, 24);
  assert.equal(iso(window.startSec), "2026-10-21T22:00:00.000Z");
  assert.equal(iso(window.endSec), "2026-10-22T22:00:00.000Z");
});

test("Sunday 2026-10-25 is a 25 hour day, 2027-03-28 a 23 hour day", () => {
  const autumn = dayWindow("2026-10-25", BERLIN);
  assert.equal(autumn.hours, 25);
  assert.equal(iso(autumn.startSec), "2026-10-24T22:00:00.000Z");
  assert.equal(iso(autumn.endSec), "2026-10-25T23:00:00.000Z");
  assert.equal(autumn.startOff, 7200);
  assert.equal(autumn.endOff, 3600);

  const spring = dayWindow("2027-03-28", BERLIN);
  assert.equal(spring.hours, 23);
  assert.equal(iso(spring.startSec), "2027-03-27T23:00:00.000Z");
  assert.equal(iso(spring.endSec), "2027-03-28T22:00:00.000Z");
});

test("windows for 2026-2028 tile with no gap or overlap", () => {
  let previousEnd = null;
  let long = 0;
  let short = 0;
  for (let date = "2026-01-01"; date <= "2028-12-31"; date = addDays(date, 1)) {
    const window = dayWindow(date, BERLIN);
    if (previousEnd !== null) assert.equal(window.startSec, previousEnd, `gap or overlap at ${date}`);
    previousEnd = window.endSec;
    if (window.hours === 25) long += 1;
    if (window.hours === 23) short += 1;
    assert.ok([23, 24, 25].includes(window.hours), `${date} is ${window.hours} h`);
  }
  assert.equal(long, 3);
  assert.equal(short, 3);
});

test("a close either side of the autumn change stays on the same date, in different buckets", () => {
  const window = dayWindow("2026-10-25", BERLIN);
  const first = at("2026-10-25T00:30:00Z"); // 02:30 CEST
  const second = at("2026-10-25T01:30:00Z"); // 02:30 CET, an hour later
  assert.equal(localDate(first, BERLIN), "2026-10-25");
  assert.equal(localDate(second, BERLIN), "2026-10-25");
  assert.equal(bucketIndex(window, first), 2);
  assert.equal(bucketIndex(window, second), 3);
  const buckets = hourBuckets(window);
  assert.equal(buckets.length, 25);
  assert.deepEqual([buckets[2].h, buckets[2].off], ["02:00", "+02:00"]);
  assert.deepEqual([buckets[3].h, buckets[3].off], ["02:00", "+01:00"]);
});

test("the spring day has 23 buckets and no 02:00 hour", () => {
  const buckets = hourBuckets(dayWindow("2027-03-28", BERLIN));
  assert.equal(buckets.length, 23);
  assert.ok(!buckets.some((bucket) => bucket.h === "02:00"));
});

test("instants outside the day have no bucket", () => {
  const window = dayWindow("2026-10-22", BERLIN);
  assert.equal(bucketIndex(window, window.startSec - 1), -1);
  assert.equal(bucketIndex(window, window.endSec), -1);
  assert.equal(bucketIndex(window, window.startSec), 0);
  assert.equal(bucketIndex(window, window.endSec - 1), 23);
});

test("a zone whose spring change skips midnight has a 23 hour day starting at 01:00", () => {
  const window = dayWindow("2018-11-04", "America/Sao_Paulo");
  assert.equal(window.hours, 23);
  assert.equal(iso(window.startSec), "2018-11-04T03:00:00.000Z");
  assert.equal(iso(window.endSec), "2018-11-05T02:00:00.000Z");
});

test("midnight belongs to the new date", () => {
  assert.equal(localDate(at("2026-10-22T21:59:59Z"), BERLIN), "2026-10-22");
  assert.equal(localDate(at("2026-10-22T22:00:00Z"), BERLIN), "2026-10-23");
});

test("offsets are read per instant", () => {
  assert.equal(offsetSec(BERLIN, at("2026-07-01T12:00:00Z")), 7200);
  assert.equal(offsetSec(BERLIN, at("2026-12-01T12:00:00Z")), 3600);
});

test("the manifest record carries the zone's offsets and the exact UTC window", () => {
  assert.deepEqual(windowRecord(dayWindow("2026-10-25", BERLIN)), {
    startUtc: "2026-10-24T22:00:00Z", endUtc: "2026-10-25T23:00:00Z",
    startOff: "+02:00", endOff: "+01:00", hours: 25,
  });
});

test("ISO weeks, including week 53", () => {
  assert.equal(isoWeekKey("2026-10-05"), "2026-W41");
  assert.equal(isoWeekKey("2026-12-31"), "2026-W53");
  assert.equal(isoWeekKey("2027-01-03"), "2026-W53");
  assert.equal(isoWeekKey("2027-01-04"), "2027-W01");
  assert.equal(isoWeekKey("2025-12-29"), "2026-W01");
  assert.deepEqual(weekDates("2026-10-22"),
    ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
});

test("calendar helpers", () => {
  assert.equal(weekdayOf("2026-10-22"), 4);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-07", "2026-10-22"), 15);
  assert.equal(monthDates("2026-02-10").length, 28);
  assert.equal(monthDates("2028-02-10").length, 29);
  assert.throws(() => parseDate("2026-02-30"), RangeError);
  assert.throws(() => parseDate("22/10/2026"), RangeError);
});

test("zones: local resolves to a real IANA id, unknown ids are refused", () => {
  assert.equal(resolveZone(BERLIN), BERLIN);
  assert.ok(resolveZone("local").length > 0);
  assert.throws(() => resolveZone("Nowhere/Land"), RangeError);
});

test("the settle guard holds a day back until 30 minutes after it ends", () => {
  // 2026-10-22 ends at 22:00Z (midnight in Berlin).
  assert.equal(lastSettledDate(at("2026-10-22T22:10:00Z"), BERLIN, 30), "2026-10-21");
  assert.equal(lastSettledDate(at("2026-10-22T22:31:00Z"), BERLIN, 30), "2026-10-22");
  // The 25 hour day ends at 23:00Z on 10-25.
  assert.equal(lastSettledDate(at("2026-10-25T23:10:00Z"), BERLIN, 30), "2026-10-24");
  assert.equal(lastSettledDate(at("2026-10-25T23:31:00Z"), BERLIN, 30), "2026-10-25");
});

test("pending days run from the season start to the last settled day, skipping frozen ones", () => {
  const frozen = new Set();
  for (let date = "2026-10-07"; date <= "2026-10-20"; date = addDays(date, 1)) frozen.add(date);
  const pending = pendingDays({
    nowSec: at("2026-10-22T23:00:00Z"), zone: BERLIN, frozen, settleMin: 30, seasonStart: "2026-10-07",
  });
  assert.deepEqual(pending, ["2026-10-21", "2026-10-22"]);

  frozen.delete("2026-10-12");
  const withHole = pendingDays({
    nowSec: at("2026-10-22T23:00:00Z"), zone: BERLIN, frozen, settleMin: 30, seasonStart: "2026-10-07",
  });
  assert.deepEqual(withHole, ["2026-10-12", "2026-10-21", "2026-10-22"]);
});
