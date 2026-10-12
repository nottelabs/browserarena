import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeProxyResultsIndex } from "./manifest.js";

test("published index retains all provider days and excludes incomplete or unrelated directories", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-index-"));
  try {
    for (const relative of ["steel/2026-10-11", "steel/2026-10-12", "notte/2026-10-12", "steel/diagnostics", "steel/2026-10-13"]) {
      const dir = path.join(base, "proxy-get", relative);
      fs.mkdirSync(dir, { recursive: true });
      if (!relative.endsWith("2026-10-13")) fs.writeFileSync(path.join(dir, "results.jsonl"), "{}\n");
    }
    writeProxyResultsIndex(base);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, "proxy-get/index.json"), "utf8")), {
      version: 1, providers: [{ name: "notte", dates: ["2026-10-12"] }, { name: "steel", dates: ["2026-10-11", "2026-10-12"] }],
    });
    assert.equal(fs.existsSync(path.join(base, "proxy-get/index.json.tmp")), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
