import { test } from "node:test";
import assert from "node:assert/strict";
import { dayBounds, localInstant } from "../../src/lib/calendarTime.js";
test("business-day boundaries honor 23-hour and 25-hour DST days", () => {
  for (const [day, hours] of [
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ] as const) {
    const { from, to } = dayBounds(day, "America/New_York");
    assert.equal((Date.parse(to) - Date.parse(from)) / 3600000, hours);
  }
  assert.equal(
    dayBounds("2028-02-29", "America/New_York").from,
    "2028-02-29T05:00:00.000Z",
  );
});
test("schedule input rejects impossible dates and both DST ambiguities", () => {
  assert.throws(
    () => localInstant("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => localInstant("2026-11-01T01:30", "America/New_York"),
    /occurs twice/,
  );
  assert.throws(
    () => localInstant("2026-02-30T10:00", "America/New_York"),
    /does not exist/,
  );
  assert.equal(
    localInstant("2026-11-02T10:00", "America/New_York"),
    "2026-11-02T15:00:00.000Z",
  );
});
