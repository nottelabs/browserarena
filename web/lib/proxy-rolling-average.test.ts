import assert from "node:assert/strict";
import test from "node:test";
import { proxyRollingAverage } from "./proxy-rolling-average";
import type { ProxyHistoryDay } from "./proxy-get-history";

const day = (date: string, value: number | null): ProxyHistoryDay => ({ date, compatible: true, providers: [{
  provider: "STEEL", displayName: "Steel", attempts: 10, successes: value === null ? 0 : 10,
  medianGetMs: value, medianFirstByteMs: value, costPerSuccessUsd: value,
}] });

test("rolling average uses an inclusive seven-calendar-day window, with partial windows at the start", () => {
  const rows = [day("2026-10-01", 100), day("2026-10-02", 300), day("2026-10-07", 500), day("2026-10-08", 700)];
  const result = proxyRollingAverage(rows, "medianGetMs");
  assert.equal(result[0].providers[0].value, 100);
  assert.equal(result[1].providers[0].value, 200);
  assert.equal(result[2].providers[0].value, 300);
  assert.equal(result[3].providers[0].value, 500);
  assert.equal(result[3].providers[0].count, 3);
});
test("missing days and null measurements remain gaps, and unknown cost is not zero", () => {
  const rows = [day("2026-10-01", 10), { date: "2026-10-02", compatible: false, providers: [] }, day("2026-10-03", null), day("2026-10-04", 30)];
  const result = proxyRollingAverage(rows, "costPerSuccessUsd");
  assert.deepEqual(result[1].providers, []);
  assert.equal(result[2].providers[0].value, null);
  assert.equal(result[3].providers[0].value, 20);
  assert.equal(result[3].providers[0].count, 2);
});
