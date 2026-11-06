/**
 * The benchmark pages send the browser only the data their client components
 * read. These tests pin what is kept, so a trimmed field is a deliberate choice.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { HistoricalLeaderboardResult, HistoricalProviderPoint } from "./data-shared";
import { HISTORY_START_DATE, historyChartData } from "./history-chart-data";
import { HISTORY_RANGES, filterDatesToRange } from "./history-range";
import { proxyStatsForClient, type ProxyGetRecord, type ProxyGetStats } from "./proxy-get";
import { compactWorkloadKeys, type ProxyHistoryDay } from "./proxy-get-history";
import { proxyRollingAverage } from "./proxy-rolling-average";

function dailyDates(start: string, count: number): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, day) => new Date(first + day * 86_400_000).toISOString().slice(0, 10));
}

function point(date: string, base: number): HistoricalProviderPoint {
  return {
    date, lastEntryAt: `${date}T03:00:00Z`, totalRuns: 100, successRate: 99,
    medianCreationMs: base, medianConnectMs: base + 1, medianGotoMs: base + 2, medianScriptMs: 0, medianReleaseMs: base + 3,
    p90CreationMs: base + 10, p90ConnectMs: base + 11, p90GotoMs: base + 12, p90ScriptMs: 0, p90ReleaseMs: base + 13,
    p95CreationMs: base + 20, p95ConnectMs: base + 21, p95GotoMs: base + 22, p95ScriptMs: 0, p95ReleaseMs: base + 23,
    p99CreationMs: base + 30, p99ConnectMs: base + 31, p99GotoMs: base + 32, p99ScriptMs: 0, p99ReleaseMs: base + 33,
    totalTimeMs: base + 40, p90TotalMs: base + 50, p95TotalMs: base + 60, p99TotalMs: base + 70,
  };
}

const dates = dailyDates("2026-03-01", 250);
const history: HistoricalLeaderboardResult = {
  dates,
  providers: [{
    provider: "NOTTE", displayName: "Notte", pricePerHour: 0.05, perSessionFee: null,
    points: dates.map((date, index) => point(date, index)),
  }],
};

test("lifecycle history keeps every date the longest range can show", () => {
  const longest = Math.max(...HISTORY_RANGES.map((range) => range.days));
  const chart = historyChartData(history, "median");
  assert.deepEqual(chart.dates, filterDatesToRange(dates, longest, HISTORY_START_DATE));
  for (const range of HISTORY_RANGES) {
    assert.deepEqual(
      filterDatesToRange(chart.dates, range.days, HISTORY_START_DATE),
      filterDatesToRange(dates, range.days, HISTORY_START_DATE),
      `${range.label} shows the same dates`
    );
  }
  assert.deepEqual(chart.providers[0].points.map((item) => item.date), chart.dates);
});

test("lifecycle history keeps an older selected day for the comparison chart", () => {
  const chart = historyChartData(history, "median", "2026-05-20");
  assert.ok(chart.dates.includes("2026-05-20"));
  assert.ok(chart.providers[0].points.some((item) => item.date === "2026-05-20"));
});

test("lifecycle history keeps only the selected percentile", () => {
  const latest = historyChartData(history, "p95").providers[0].points.at(-1)!;
  const original = history.providers[0].points.at(-1)!;
  assert.deepEqual(latest, {
    date: original.date, successRate: original.successRate,
    p95CreationMs: original.p95CreationMs, p95ConnectMs: original.p95ConnectMs, p95GotoMs: original.p95GotoMs,
    p95ReleaseMs: original.p95ReleaseMs, p95TotalMs: original.p95TotalMs,
  });
});

test("proxy client stats keep the sample fields the browser reads", () => {
  const sample = {
    run_id: "daily-proxy-2026-11-05", status: "success", get_ms: 300, first_byte_ms: 120, error_message: null,
    session_id: "s", url: "https://target.example/payload", timeout_ms: 30000,
  } as unknown as ProxyGetRecord;
  const stats = { provider: "STEEL", attempts: 1, successes: 1, samples: [sample] } as unknown as ProxyGetStats;
  const client = proxyStatsForClient(stats);
  assert.deepEqual(client.samples, [{ run_id: "daily-proxy-2026-11-05", status: "success", get_ms: 300, first_byte_ms: 120, error_message: null }]);
  assert.equal(client.provider, "STEEL");
  assert.equal(stats.samples[0], sample, "server records are unchanged");
});

test("compact proxy workload keys keep rolling-average segments", () => {
  const day = (date: string, value: number, workloadKey: string): ProxyHistoryDay => ({ date, compatible: true, providers: [{
    provider: "STEEL", displayName: "Steel", attempts: 1, successes: 1,
    medianGetMs: value, medianFirstByteMs: value, costPerSuccessUsd: value, workloadKey,
  }] });
  const long = (name: string) => `[1,"https://target.example/${name}","${"a".repeat(64)}",30000]`;
  const days = [day("2026-10-01", 100, long("a")), day("2026-10-02", 200, long("a")), day("2026-10-03", 900, long("b")), day("2026-10-04", 300, long("b"))];
  const compact = compactWorkloadKeys(days);
  assert.deepEqual(compact.map((item) => item.providers[0].workloadKey), ["0", "0", "1", "1"]);
  assert.deepEqual(proxyRollingAverage(compact, "medianGetMs", 7), proxyRollingAverage(days, "medianGetMs", 7));
});
