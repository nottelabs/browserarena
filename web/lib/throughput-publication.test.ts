import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { throughputPublication } from "./throughput-publication";
import { loadBrowserThroughputHistory, loadPublishedBrowserThroughput } from "./browser-throughput-data";
import type { ThroughputHistory } from "./browser-throughput-shared";

function history(runs: Record<string, string[]>): ThroughputHistory {
  return {
    dates: [...new Set(Object.values(runs).flat())].sort(),
    providers: Object.entries(runs).map(([provider, dates]) => ({
      provider, displayName: provider,
      // Null timings represent published attempts that all failed.
      points: dates.map((date) => ({ date, actionsPerSecond: null, taskMs: null, screenshotMs: null })),
    })),
  };
}

const yesterday = "2026-10-27";
const today = "2026-10-28";
const split = history({ STEEL: [yesterday], NOTTE: [yesterday, today], BROWSERLESS: [yesterday, today], TINYFISH: [today] });

test("morning publication keeps the complete prior day, including when a provider joins today", () => {
  const result = throughputPublication(split);
  assert.equal(result.selectedDate, yesterday);
  assert.deepEqual(result.coverage, [
    { date: yesterday, reported: 3, expected: 3, complete: true },
    { date: today, reported: 3, expected: 4, complete: false },
  ]);
});

test("the default advances when the other region arrives, even with failed providers", () => {
  const complete = history({ STEEL: [yesterday, today], NOTTE: [yesterday, today], BROWSERLESS: [yesterday, today] });
  assert.equal(throughputPublication(complete).selectedDate, today);
});

test("an explicit partial date is preserved; unknown dates use the complete default", () => {
  assert.equal(throughputPublication(split, today).selectedDate, today);
  assert.equal(throughputPublication(split, "2026-10-29").selectedDate, yesterday);
});

test("calendar gaps and empty provider series are not published days", () => {
  const data = history({ STEEL: ["2026-10-26", today], NOTTE: ["2026-10-26"], EMPTY: [] });
  data.dates = ["2026-10-26", yesterday, today];
  const result = throughputPublication(data);
  assert.deepEqual(result.dates, ["2026-10-26", today]);
  assert.equal(result.selectedDate, "2026-10-26");
  assert.equal(throughputPublication(history({})).selectedDate, undefined);
});

test("publication reads measured attempts at the selected concurrency and pins every leaderboard row", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "throughput-publication-"));
  const originalCwd = process.cwd();
  const write = (provider: string, date: string, concurrency: number, warmup = false) => {
    const dir = path.join(root, "results/browser-throughput", provider.toLowerCase(), date, `c${concurrency}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "results.jsonl"), JSON.stringify({
      provider, created_at: `${date}T06:00:00Z`, concurrency, warmup,
      success: false, error_stage: "connect_over_cdp", error_message: "quota exhausted",
      loops: 1, actions_total: 10, actions_completed: 0, actions: [], task_ms: null, actions_per_second: null,
    }) + "\n");
  };
  try {
    fs.mkdirSync(path.join(root, "web"));
    process.chdir(path.join(root, "web"));
    for (const provider of ["STEEL", "NOTTE", "BROWSERLESS"]) write(provider, yesterday, 1);
    for (const provider of ["NOTTE", "BROWSERLESS", "TINYFISH"]) write(provider, today, 1);
    write("STEEL", today, 1, true); // Warm-up-only upload cannot complete the day.
    write("STEEL", today, 10); // Another concurrency cannot complete c1 either.
    write("KERNEL_HEADFUL", "2026-10-26", 1); // Hidden variant cannot block publication.

    const result = await loadPublishedBrowserThroughput();
    assert.equal(result.leaderboard.metadata.date, yesterday);
    assert.equal(result.leaderboard.providers.length, 3);
    assert.ok(result.leaderboard.providers.every((row) => row.runDate === yesterday));
    assert.equal(result.publication.latestCompleteDate, yesterday);

    const partial = await loadPublishedBrowserThroughput(1, today);
    assert.equal(partial.leaderboard.metadata.date, today);
    assert.equal(partial.leaderboard.providers.length, 3);
    assert.deepEqual(partial.publication.coverage.at(-1), { date: today, reported: 3, expected: 4, complete: false });

    write("STEEL", today, 1);
    const completed = await loadPublishedBrowserThroughput();
    assert.equal(completed.leaderboard.metadata.date, today);
    assert.equal(completed.leaderboard.providers.length, 4);
    assert.ok(completed.leaderboard.providers.every((row) => row.actionsPerSecond.samples === 0));
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote history shares summaries and in-flight work, expires, and retries failed loads", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "throughput-remote-"));
  const originalCwd = process.cwd();
  const requests: string[] = [];
  let now = 1_000;
  let failNextListing = false;
  let runDates = [yesterday, today];
  const listing = (names: string[]) => Response.json(names.map((name) => ({ name, type: "dir", path: name })));
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requests.push(url.pathname);
    if (url.hostname === "api.github.com") {
      if (failNextListing) { failNextListing = false; throw new Error("GitHub unavailable"); }
      if (url.pathname.endsWith("/browser-throughput")) return listing(["steel", "notte"]);
      if (/\/c\d+$/.test(url.pathname)) throw new Error("Unexpected listing");
      if (/\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) return listing(["c1", "c10"]);
      return listing(runDates);
    }
    const match = url.pathname.match(/\/browser-throughput\/([^/]+)\/([^/]+)\/c(\d+)\/results.jsonl$/)!;
    const [, provider, date, concurrency] = match;
    return new Response(JSON.stringify({
      provider: provider.toUpperCase(), created_at: `${date}T06:00:00Z`, concurrency: Number(concurrency),
      success: false, loops: 1, actions_total: 10, actions_completed: 0, actions: [], task_ms: null,
    }) + "\n");
  });
  try {
    fs.mkdirSync(path.join(root, "web"));
    process.chdir(path.join(root, "web")); // No results directory: exercise GitHub fallback.
    const [first, concurrent] = await Promise.all([loadBrowserThroughputHistory(), loadBrowserThroughputHistory()]);
    assert.equal(first, concurrent);
    assert.equal(requests.length, 7, "one archive load serves concurrent calls");
    assert.equal(await loadBrowserThroughputHistory(), first);
    assert.equal(requests.length, 7, "a warm call does not fetch or summarize history again");

    const selected = await loadPublishedBrowserThroughput(1, today);
    assert.equal(selected.history, first, "different selected dates share the same cached history");
    assert.equal(selected.leaderboard.metadata.date, today);
    assert.equal(requests.filter((url) => url.includes(`/${yesterday}/c1/`)).length, 2,
      "the API loads only selected-day rows after the history is cached");
    const otherConcurrency = await loadBrowserThroughputHistory(10);
    assert.notEqual(otherConcurrency, first);

    now += 60_001;
    runDates = [...runDates, "2026-10-29"];
    const refreshed = await loadBrowserThroughputHistory();
    assert.notEqual(refreshed, first);
    assert.equal(refreshed.dates.at(-1), "2026-10-29");

    failNextListing = true;
    await assert.rejects(loadBrowserThroughputHistory(42), /GitHub unavailable/);
    assert.equal((await loadBrowserThroughputHistory(42)).providers.length, 2,
      "a rejected load is removed from the cache");

    for (let concurrency = 100; concurrency < 109; concurrency++) await loadBrowserThroughputHistory(concurrency);
    const beforeEvictedLoad = requests.length;
    await loadBrowserThroughputHistory(100);
    assert.ok(requests.length > beforeEvictedLoad, "old concurrency entries are evicted instead of growing without bound");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
    t.mock.restoreAll();
  }
});
