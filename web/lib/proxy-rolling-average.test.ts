import assert from "node:assert/strict";
import test from "node:test";
import { proxyHistoryChartData, proxyRollingAverage } from "./proxy-rolling-average";
import type { ProxyHistoryDay } from "./proxy-get-history";

const day = (date: string, value: number | null, workloadKey = "original"): ProxyHistoryDay => ({ date, compatible: true, providers: [{
  provider: "STEEL", displayName: "Steel", attempts: 10, successes: value === null ? 0 : 10,
  medianGetMs: value, medianFirstByteMs: value, costPerSuccessUsd: value, workloadKey,
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

test("workload transitions restart the average even when an earlier workload returns", () => {
  const rows = [day("2026-10-10", 100), day("2026-10-11", 300),
    day("2026-10-12", 900, "temporary"), day("2026-10-13", 500), day("2026-10-14", 700)];
  const result = proxyRollingAverage(rows, "medianGetMs");
  assert.deepEqual(result.map(d => [d.providers[0].value, d.providers[0].count]), [[100, 1], [200, 2], [900, 1], [500, 1], [600, 2]]);
  const chart = proxyHistoryChartData(rows, "medianGetMs", 7);
  assert.equal(chart.series.length, 3);
  assert.deepEqual(chart.series.map(line => chart.data.map(d => d[line.dataKey])), [
    [100, 200, null, null, null], [null, null, 900, null, null], [null, null, null, 500, 600],
  ], "each workload segment has its own line, with no connection across adjacent changed days");
});

test("a failed new workload still resets the average before its next successful day", () => {
  const rows = [day("2026-10-12", 100), day("2026-10-13", null, "new"), day("2026-10-14", 700, "new")];
  const result = proxyRollingAverage(rows, "medianGetMs");
  assert.equal(result[1].providers[0].value, null);
  assert.equal(result[2].providers[0].value, 700);
  assert.equal(result[2].providers[0].count, 1);
});

test("daily chart series preserve calendar gaps instead of connecting absent measurements", () => {
  const rows = [day("2026-10-12", 100), { date: "2026-10-13", compatible: false, providers: [] }, day("2026-10-14", 300)];
  const chart = proxyHistoryChartData(rows, "medianGetMs");
  assert.equal(chart.series.length, 1);
  assert.deepEqual(chart.data.map(d => d[chart.series[0].dataKey]), [100, null, 300]);
});
test("missing days and null measurements remain gaps, and unknown cost is not zero", () => {
  const rows = [day("2026-10-01", 10), { date: "2026-10-02", compatible: false, providers: [] }, day("2026-10-03", null), day("2026-10-04", 30)];
  const result = proxyRollingAverage(rows, "costPerSuccessUsd");
  assert.deepEqual(result[1].providers, []);
  assert.equal(result[2].providers[0].value, null);
  assert.equal(result[3].providers[0].value, 20);
  assert.equal(result[3].providers[0].count, 2);
});
