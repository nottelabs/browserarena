import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { throughputPublication } from "./throughput-publication";
import { loadPublishedBrowserThroughput } from "./browser-throughput-data";
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
