import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCaptchaCampaigns } from "./captcha-data";

test("CAPTCHA loader distinguishes no campaigns, partial campaigns, and invalid data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "captcha-data-"));
  const directory = path.join(root, "campaigns");
  try {
    assert.deepEqual(await loadCaptchaCampaigns(directory), []);
    await fs.mkdir(directory);
    const campaign = { benchmark: "captcha", schema_version: 1, protocol_version: 2, id: "partial",
      started_at: "2026-10-28T00:00:00Z", finished_at: "2026-10-28T00:01:00Z", revision: "a".repeat(40),
      providers: ["kernel"], rounds: 1, concurrency: 1, complete: false, halted: true, interrupted: true, attempts: [] };
    await fs.writeFile(path.join(directory, "partial.json"), JSON.stringify(campaign));
    assert.equal((await loadCaptchaCampaigns(directory))[0].complete, false);
    await fs.writeFile(path.join(directory, "bad.json"), JSON.stringify(campaign));
    await assert.rejects(loadCaptchaCampaigns(directory), /filename and ID/);
    await fs.writeFile(path.join(directory, "bad.json"), "invalid json");
    await assert.rejects(loadCaptchaCampaigns(directory));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
