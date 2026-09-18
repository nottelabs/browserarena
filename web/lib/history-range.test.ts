/**
 * Unit tests for the history chart range selector.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_RANGES,
  filterDatesToRange,
  isIsolatedPoint,
  rangeStartDate,
} from "./history-range";

const FLOOR = "2026-05-15";

function consecutiveDates(start: string, count: number): string[] {
  const cursor = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, () => {
    const ymd = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return ymd;
  });
}

test("rangeStartDate is inclusive of the latest date", () => {
  assert.equal(rangeStartDate("2026-09-18", 1), "2026-09-18");
  assert.equal(rangeStartDate("2026-09-18", 7), "2026-09-12");
});

test("rangeStartDate crosses month and year boundaries", () => {
  assert.equal(rangeStartDate("2026-03-02", 7), "2026-02-24");
  assert.equal(rangeStartDate("2026-01-03", 30), "2025-12-05");
});

test("each range keeps one date per calendar day when runs are daily", () => {
  const dates = consecutiveDates("2026-05-15", 127); // through 2026-09-18
  for (const range of HISTORY_RANGES) {
    const visible = filterDatesToRange(dates, range.days, FLOOR);
    assert.equal(visible.length, range.days, range.key);
    assert.equal(visible[visible.length - 1], "2026-09-18", range.key);
  }
});

test("the window is calendar-based, so missing run days shrink the count", () => {
  const dates = ["2026-09-01", "2026-09-12", "2026-09-15", "2026-09-18"];
  assert.deepEqual(filterDatesToRange(dates, 7, FLOOR), [
    "2026-09-12",
    "2026-09-15",
    "2026-09-18",
  ]);
});

test("the floor still applies when the range reaches past it", () => {
  const dates = ["2026-03-20", "2026-05-14", "2026-05-15", "2026-06-01"];
  assert.deepEqual(filterDatesToRange(dates, 90, FLOOR), [
    "2026-05-15",
    "2026-06-01",
  ]);
});

test("no eligible dates yields an empty range", () => {
  assert.deepEqual(filterDatesToRange([], 7, FLOOR), []);
  assert.deepEqual(filterDatesToRange(["2026-03-20"], 7, FLOOR), []);
});

test("isIsolatedPoint flags values with no neighbour on either side", () => {
  const values = [0.9, null, 0.8, null, null, 0.7, 0.6, undefined, 0.5];
  const isolated = values.map((_, index) => isIsolatedPoint(values, index));
  assert.deepEqual(isolated, [
    true, // leading point followed by a gap
    false,
    true, // gap on both sides
    false,
    false,
    false, // connected to the next point
    false, // connected to the previous point
    false,
    true, // trailing point preceded by a gap
  ]);
});

test("a lone point is isolated", () => {
  assert.equal(isIsolatedPoint([0.4], 0), true);
});
