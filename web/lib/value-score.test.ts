/**
 * The Value Score's latency dimension carries a p95 tail term, so two
 * providers with the same median no longer tie when one has a long tail.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computeValueScores, latencyScore, normalizeLatency, TAIL_SHARE } from "./value-score";

const row = (provider: string, totalTimeMs: number, p95TotalMs: number, successRate = 100, pricePerHour: number | null = 0.1) => ({
  provider,
  totalTimeMs,
  p95TotalMs,
  successRate,
  pricePerHour,
});

test("normalizeLatency maps the anchors to 1 and 0 and clamps beyond them", () => {
  assert.equal(normalizeLatency(0), 1);
  assert.equal(normalizeLatency(10_000), 0);
  assert.equal(normalizeLatency(50_000), 0);
  assert.equal(normalizeLatency(5_000), 0.5);
});

test("latencyScore blends the selected percentile with the p95 tail", () => {
  const head = normalizeLatency(1_000);
  const tail = normalizeLatency(4_000);
  assert.equal(latencyScore(1_000, 4_000), (1 - TAIL_SHARE) * head + TAIL_SHARE * tail);
  // Without a tail value, the head alone decides.
  assert.equal(latencyScore(1_000, null), head);
});

test("same median, longer tail, lower score", () => {
  const steady = row("STEADY", 1_000, 1_200);
  const spiky = row("SPIKY", 1_000, 6_000);
  const scores = computeValueScores([steady, spiky], "totalTimeMs", { latency: 1, reliability: 0, cost: 0 });
  assert.ok(scores.get("STEADY")! > scores.get("SPIKY")!);
  // The tail can only move the latency dimension by its share.
  const gap = scores.get("STEADY")! - scores.get("SPIKY")!;
  assert.ok(gap <= TAIL_SHARE + 1e-9);
});

test("selecting the p95 view scores the tail alone", () => {
  const p = row("P", 1_000, 3_000);
  const scores = computeValueScores([p], "p95TotalMs", { latency: 1, reliability: 0, cost: 0 });
  assert.ok(Math.abs(scores.get("P")! - normalizeLatency(3_000)) < 1e-9);
});

test("weights normalise and a provider without successful runs stays unscored", () => {
  const good = row("GOOD", 500, 600, 100, 0.05);
  const dead = row("DEAD", 0, 0, 0, 0.05);
  const scores = computeValueScores([good, dead], "totalTimeMs", { latency: 50, reliability: 50, cost: 0 });
  assert.ok(scores.has("GOOD"));
  assert.ok(!scores.has("DEAD"));
  const s = scores.get("GOOD")!;
  assert.ok(s > 0 && s <= 1);
});
