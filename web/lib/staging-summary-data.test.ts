import assert from "node:assert/strict";
import test from "node:test";
import type { ResultsSource } from "./data";
import { loadStagingSummaryInput, type SummaryLoaders } from "./staging-summary-data";

const SOURCE: ResultsSource = { repo: "nottelabs/browserarena-staging-results", branch: "main", token: "t" };
const URL = "https://staging-console.notte.cc/api/admin/browserarena-internal";
const DAYS = ["2026-11-08", "2026-11-09"];

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
