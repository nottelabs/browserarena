/**
 * Unit tests for the stealth leaderboard.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadStealth, rankStealth, wilson } from "./stealth";

test("access rate excludes errors and ranks providers", () => {
  const rows = rankStealth([
    { provider: "A", accessible: 1, blocked: 3, errors: 5, sitesAccessed: 1 },
    { provider: "B", accessible: 3, blocked: 1, errors: 0, sitesAccessed: 2 },
    { provider: "C", accessible: 0, blocked: 0, errors: 4, sitesAccessed: 0 },
  ]);
  assert.deepEqual(rows.map((row) => row.provider), ["B", "A", "C"]);
  assert.equal(rows[1].accessRate, 0.25);
  assert.equal(rows[2].accessRate, null);
  assert.equal(rows[2].interval, null);
});

test("wilson interval", () => {
  const [low, high] = wilson(5, 10)!;
  assert.ok(Math.abs(low - 0.237) < 0.001);
  assert.ok(Math.abs(high - 0.763) < 0.001);
});

test("published summary is consistent", () => {
  const summary = loadStealth();
  for (const row of summary.providers) {
    assert.equal(row.accessible + row.blocked + row.errors, summary.sites * summary.rounds, row.provider);
    assert.ok(row.sitesAccessed <= summary.sites, row.provider);
  }
});
