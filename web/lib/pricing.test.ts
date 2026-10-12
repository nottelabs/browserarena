/**
 * Unit tests for provider unit pricing.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { getMedianCostUsd, getPerSessionFee, getPricePerHour } from "./pricing";

test("Notte is priced at $0.01/hr with no per-session fee", () => {
  assert.equal(getPricePerHour("NOTTE"), 0.01);
  assert.equal(getPerSessionFee("NOTTE"), null);
});

test("Notte cost bills per minute with a one-minute minimum", () => {
  // Anything under a minute bills as one minute.
  assert.equal(getMedianCostUsd("NOTTE", [0]), 0.00016667);
  assert.equal(getMedianCostUsd("NOTTE", [10_000]), 0.00016667);
  assert.equal(getMedianCostUsd("NOTTE", [60_000]), 0.00016667);
  // Past the first minute, time rounds up to the next whole minute.
  assert.equal(getMedianCostUsd("NOTTE", [61_000]), 0.00033333);
  assert.equal(getMedianCostUsd("NOTTE", [3_600_000]), 0.01);
});

test("median cost is taken across runs", () => {
  assert.equal(getMedianCostUsd("NOTTE", [10_000, 90_000, 3_600_000]), 0.00033333);
  assert.equal(getMedianCostUsd("NOTTE", []), null);
  assert.equal(getMedianCostUsd("UNKNOWN", [10_000]), null);
});
