import assert from "node:assert/strict";
import { test } from "node:test";

import { NotteProvider } from "./notte.js";

test("cost follows the $0.01/hr rate, billed per minute with a one-minute minimum", () => {
  const provider = new NotteProvider();

  assert.equal(provider.computeCost(3600), 0.01);
  // Anything under a minute bills as one minute.
  assert.equal(provider.computeCost(0), 0.00016667);
  assert.equal(provider.computeCost(10), 0.00016667);
  assert.equal(provider.computeCost(60), 0.00016667);
  // Past the first minute, time rounds up to the next whole minute.
  assert.equal(provider.computeCost(61), 0.00033333);
  assert.equal(provider.computeCost(90), 0.00033333);
});
