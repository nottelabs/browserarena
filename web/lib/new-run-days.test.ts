/**
 * Unit tests for the run-days a push added (edge alert dedup).
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { newRunDays, runDayKey } from "./new-run-days";

const files: Record<string, string> = {
  "results/hello-browser/notte/2026-11-18/c1/results.jsonl": '\n{"provider":"NOTTE","id":"a"}\n{"provider":"NOTTE"}',
  "results/hello-browser/notte/2026-11-18/c10/results.jsonl": '{"provider":"NOTTE"}',
  "results/hello-browser/browser-use/2026-11-18/c1/results.jsonl": '{"provider":"BROWSER_USE"}',
  "results/hello-browser/broken/2026-11-18/c1/results.jsonl": "not json",
};

function firstLine(path: string): string | null {
  const text = files[path];
  if (text === undefined) return null;
  return text.split("\n").find((l) => l.trim()) ?? null;
}

test("keys each changed hello-browser file by the provider in it", () => {
  const days = newRunDays(Object.keys(files).join("\n"), firstLine);
  assert.deepEqual(
    [...days].sort(),
    [
      runDayKey("BROWSER_USE", "2026-11-18", 1),
      runDayKey("NOTTE", "2026-11-18", 1),
      runDayKey("NOTTE", "2026-11-18", 10),
    ].sort()
  );
});

test("a push of other benchmarks adds no run-day", () => {
  const changed = [
    "results/proxy-get/notte/2026-11-18/results.jsonl",
    "results/browser-throughput/notte/2026-11-18/c1/results.jsonl",
    "results/hello-browser/notte/2026-11-18/_meta.json",
  ].join("\n");
  assert.equal(newRunDays(changed, firstLine).size, 0);
});

test("deleted files and empty input add nothing", () => {
  assert.equal(newRunDays("results/hello-browser/gone/2026-11-18/c1/results.jsonl", firstLine).size, 0);
  assert.equal(newRunDays("", firstLine).size, 0);
});
