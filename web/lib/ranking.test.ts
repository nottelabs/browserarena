/**
 * Unit tests for leaderboard ranking eligibility.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { hasSuccessfulRuns, sortRanked } from "./ranking";

type Row = { name: string; successRate: number; latencyMs: number };

const ROWS: Row[] = [
  { name: "slow", successRate: 100, latencyMs: 2000 },
  { name: "broken-b", successRate: 0, latencyMs: 0 },
  { name: "fast", successRate: 99, latencyMs: 400 },
  { name: "broken-a", successRate: 0, latencyMs: 0 },
];

const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);

test("hasSuccessfulRuns is false only when every run failed", () => {
  assert.equal(hasSuccessfulRuns({ successRate: 0 }), false);
  assert.equal(hasSuccessfulRuns({ successRate: 1 }), true);
  assert.equal(hasSuccessfulRuns({ successRate: 100 }), true);
});

test("a provider with 0 ms latency from all-failed runs is not the fastest", () => {
  const sorted = sortRanked(
    ROWS,
    hasSuccessfulRuns,
    (a, b) => a.latencyMs - b.latencyMs,
    byName
  );
  assert.deepEqual(
    sorted.map((row) => row.name),
    ["fast", "slow", "broken-a", "broken-b"]
  );
});

test("unranked rows stay last when the sort direction flips", () => {
  const sorted = sortRanked(
    ROWS,
    hasSuccessfulRuns,
    (a, b) => b.latencyMs - a.latencyMs,
    byName
  );
  assert.deepEqual(
    sorted.map((row) => row.name),
    ["slow", "fast", "broken-a", "broken-b"]
  );
});

test("sortRanked does not mutate its input", () => {
  const before = ROWS.map((row) => row.name);
  sortRanked(ROWS, hasSuccessfulRuns, (a, b) => a.latencyMs - b.latencyMs, byName);
  assert.deepEqual(ROWS.map((row) => row.name), before);
});
