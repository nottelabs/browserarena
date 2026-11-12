import assert from "node:assert/strict";
import test from "node:test";
import type { ResultsSource } from "./data";
import type { HistoricalProviderPoint } from "./data-shared";
import { loadStagingSummaryInput, stagingBaselineCheck, type SummaryLoaders } from "./staging-summary-data";

const SOURCE: ResultsSource = { repo: "nottelabs/browserarena-staging-results", branch: "main", token: "t" };
const URL = "https://staging-console.notte.cc/api/admin/browserarena-internal";
const DAYS = ["2026-11-08", "2026-11-09"];

/** One staging day: `creation` carries the latency, the other phases are flat. */
function point(date: string, creation: number, successRate = 100): HistoricalProviderPoint {
  return {
    date, lastEntryAt: `${date}T20:01:00.000Z`, totalRuns: 100, successRate,
    medianCreationMs: creation, medianConnectMs: 30, medianGotoMs: 80, medianScriptMs: 0, medianReleaseMs: 40,
    p90CreationMs: 0, p90ConnectMs: 0, p90GotoMs: 0, p90ScriptMs: 0, p90ReleaseMs: 0,
    p95CreationMs: 0, p95ConnectMs: 0, p95GotoMs: 0, p95ScriptMs: 0, p95ReleaseMs: 0,
    p99CreationMs: 0, p99ConnectMs: 0, p99GotoMs: 0, p99ScriptMs: 0, p99ReleaseMs: 0,
    totalTimeMs: creation + 150, p90TotalMs: 0, p95TotalMs: 0, p99TotalMs: 0,
  };
}

/** `n` consecutive days ending 2026-11-30, creation from `values(i)`. */
function days(n: number, values: (i: number) => number): HistoricalProviderPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 30 - (n - 1 - i)));
    return point(d.toISOString().slice(0, 10), values(i));
  });
}

/** Two days of results on both targets; day 2026-11-09 is "latest". */
function fakes(statuses: Record<string, number> = {}) {
  const calls: string[] = [];
  const stat = (provider: string, date: string, totalTimeMs: number) => ({
    provider, runDate: date, totalRuns: 100, successRate: 100, totalTimeMs, p90TotalMs: totalTimeMs + 50,
  });
  const thr = (provider: string, date: string, aps: number) => ({
    provider, runDate: date, totalRuns: 20, successRate: 90, actionsPerSecond: { median: aps }, taskMs: { median: 2000 },
  });
  const loaders = {
    async loadLeaderboard(_b: string, date: string | undefined, _p: string, _s: string, concurrency: number, source?: ResultsSource) {
      calls.push(`lifecycle c${concurrency} ${source ? "staging" : "prod"} ${date}`);
      const day = date ?? DAYS.at(-1)!;
      const offset = day === DAYS[0] ? 0 : 1000;
      return { providers: [source ? stat("NOTTE_STAGING", day, 400 + offset) : stat("NOTTE", day, 300 + offset)] };
    },
    async loadBrowserThroughputLeaderboard(_c: number, date: string | undefined, source?: ResultsSource) {
      calls.push(`throughput ${source ? "staging" : "prod"} ${date}`);
      const day = date ?? DAYS.at(-1)!;
      return { providers: [thr(source ? "NOTTE_STAGING" : "NOTTE", day, day === DAYS[0] ? 4 : 9)] };
    },
    async loadHistoricalLeaderboard(_b: string, concurrency: number, source?: ResultsSource) {
      calls.push(`history c${concurrency} ${source ? "staging" : "prod"}`);
      return { dates: DAYS, providers: [{ provider: "NOTTE_STAGING", displayName: "Notte staging", points: DAYS.map((d) => point(d, 400)) }] };
    },
    async contentsStatus(_s: ResultsSource, path: string) {
      calls.push(`contents ${path}`);
      return statuses[path] ?? 200;
    },
  } as unknown as SummaryLoaders;
  return { loaders, calls };
}

test("replaying an older day loads that day on both targets, not the latest", async () => {
  const { loaders, calls } = fakes();
  const result = await loadStagingSummaryInput("2026-11-08", SOURCE, URL, loaders);
  assert.ok(calls.filter((c) => c.startsWith("lifecycle") || c.startsWith("throughput")).every((c) => c.endsWith(" 2026-11-08")), calls.join("\n"));
  assert.equal(result.lifecycle[0]!.prod!.totalTimeMs, 300);
  assert.equal(result.lifecycle[0]!.staging!.totalTimeMs, 400);
  assert.equal(result.lifecycle[0]!.staging!.runDate, "2026-11-08");
  assert.equal(result.throughput.staging!.actionsPerSecond, 4);
  assert.ok(calls.includes("contents results/hello-browser/notte-staging/2026-11-08"));
  assert.ok(calls.includes("contents results/browser-throughput/notte-staging/2026-11-08"));
});

test("a missing staging folder is a missed run and skips the staging load", async () => {
  const { loaders, calls } = fakes({ "results/browser-throughput/notte-staging/2026-11-09": 404 });
  const result = await loadStagingSummaryInput("2026-11-09", SOURCE, URL, loaders);
  assert.equal(result.throughput.staging, null);
  assert.equal(result.throughput.stagingRan, false);
  assert.ok(!calls.includes("throughput staging 2026-11-09"));
  assert.equal(result.lifecycle[0]!.stagingRan, true);
});

test("a token that cannot read contents, or any other read error, fails instead of reporting a missed run", async () => {
  const cases: Record<string, number>[] = [
    { "README.md": 404 },
    { "README.md": 403 },
    { "results/hello-browser/notte-staging/2026-11-09": 403 },
    { "results/browser-throughput/notte-staging/2026-11-09": 500 },
  ];
  for (const statuses of cases) {
    const { loaders } = fakes(statuses);
    await assert.rejects(loadStagingSummaryInput("2026-11-09", SOURCE, URL, loaders), /cannot read nottelabs\/browserarena-staging-results/);
  }
});

test("staging history loads on each concurrency level staging ran, and too little history is not judged", async () => {
  const { loaders, calls } = fakes();
  const result = await loadStagingSummaryInput("2026-11-09", SOURCE, URL, loaders);
  assert.ok(calls.includes("history c1 staging") && calls.includes("history c10 staging"), calls.join("\n"));
  assert.ok(!calls.some((c) => c.startsWith("history") && c.endsWith("prod")));
  assert.deepEqual(result.baseline!.map((c) => [c.concurrency, c.status, c.runDays, c.runDaysNeeded]), [[1, "unknown", 2, 10], [10, "unknown", 2, 10]]);
});

test("no staging lifecycle run skips the history load", async () => {
  const { loaders, calls } = fakes({ "results/hello-browser/notte-staging/2026-11-09": 404 });
  const result = await loadStagingSummaryInput("2026-11-09", SOURCE, URL, loaders);
  assert.ok(!calls.some((c) => c.startsWith("history")));
  assert.deepEqual(result.baseline, []);
});

test("a sustained step against staging's own baseline is a regression; a one-day spike is not", () => {
  // 20 flat days at 200 ms, then 3 days at 600 ms.
  const step = stagingBaselineCheck(days(23, (i) => (i < 20 ? 200 : 600)), "2026-11-30", 1)!;
  assert.equal(step.status, "degraded");
  assert.equal(step.breaches[0]!.label, "session creation");
  assert.equal(step.breaches[0]!.baseline, 200);
  assert.equal(step.breaches[0]!.current, 600);
  assert.equal(step.breaches[0]!.onsetDate, "2026-11-28");
  // Only the last day is slow: 1 of 3, not a regression yet.
  const spike = stagingBaselineCheck(days(23, (i) => (i < 22 ? 200 : 900)), "2026-11-30", 1)!;
  assert.equal(spike.status, "ok");
  assert.deepEqual(spike.total, { baseline: 350, current: 350 });
});

test("replaying a day ignores later runs, and a day with no staging run is not judged", () => {
  const points = days(23, (i) => (i < 20 ? 200 : 600));
  assert.equal(stagingBaselineCheck(points, "2026-11-27", 1)!.status, "ok");
  assert.equal(stagingBaselineCheck(points.filter((p) => p.date !== "2026-11-29"), "2026-11-29", 1), null);
});
