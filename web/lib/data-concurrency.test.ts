import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLeaderboard } from "./data";

test("a single recorded concurrent mode remains selectable instead of falling back to empty sequential results", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-concurrency-"));
  const previous = process.cwd();
  fs.mkdirSync(path.join(root, "web"));
  const directory = path.join(root, "results", "hello-browser", "tilion", "2026-10-12", "c10");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "results.jsonl"), JSON.stringify({
    created_at: "2026-10-12T00:00:00Z", id: "fixture", provider: "TILION", concurrency: 10,
    success: true, session_creation_ms: 100, session_connect_ms: 50, page_goto_ms: 50, session_release_ms: 50,
  }) + "\n");
  try {
    process.chdir(path.join(root, "web"));
    const concurrent = await loadLeaderboard("hello-browser", undefined, "median", "latency", 10);
    assert.deepEqual(concurrent.metadata.availableConcurrencyLevels, [10]);
    assert.equal(concurrent.providers.length, 1);
    // The default selection can use the available level even if c1 has no data.
    const initial = await loadLeaderboard("hello-browser");
    assert.deepEqual(initial.metadata.availableConcurrencyLevels, [10]);
    assert.equal(initial.providers.length, 0);
    const selected = await loadLeaderboard("hello-browser", undefined, "median", "latency", initial.metadata.availableConcurrencyLevels![0]);
    assert.equal(selected.providers.length, 1);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
