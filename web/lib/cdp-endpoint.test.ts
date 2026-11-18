import assert from "node:assert/strict";
import { test } from "node:test";
import { cdpEndpointForRun } from "./data-shared";

test("shows the CDP RTT for a run from the region it was measured from", () => {
  assert.equal(cdpEndpointForRun("BROWSER_USE", "us-east-2")?.rttMs, 8);
});

test("hides the CDP RTT for a run from another region", () => {
  assert.equal(cdpEndpointForRun("BROWSER_USE", "us-east-1"), undefined);
});

test("keeps the CDP RTT for runs without a recorded region", () => {
  assert.equal(cdpEndpointForRun("BROWSER_USE", undefined)?.rttMs, 8);
});

test("returns nothing for unknown providers", () => {
  assert.equal(cdpEndpointForRun("UNKNOWN", "us-east-1"), undefined);
  assert.equal(cdpEndpointForRun(undefined, "us-east-1"), undefined);
});
