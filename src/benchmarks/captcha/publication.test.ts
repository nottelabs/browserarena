import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configuration } from "./protocol.mjs";
import { campaignCells, exportCampaign, validateCampaign } from "./publication.js";
import { exportFiles } from "./export.js";

function evidence() {
  const config = configuration({ providers: ["kernel"], rounds: 1 });
  return { summary: { configuration: { ...config, started_at: "2026-10-28T00:00:00Z", browserarena_sha: "a".repeat(40), hostname: "private-host" },
    finished_at: "2026-10-28T00:02:00Z", complete: false, halted: true, interrupted: false },
    rows: [{ id: "r01-kernel-hcaptcha", provider: "kernel", type: "hcaptcha", round: 1, stage: "solve", status: "token_delivered",
      token_ms: 1500, accepted_ms: null, session_id: "private-session", error: "private-error", provider_verdict: { secret: "private-token" },
      cleanup: { released: true, disconnected: true }, screenshot: "private.png" }] };
}

test("public export retains partial coverage and only allowlisted outcome data", () => {
  const { summary, rows } = evidence();
  const result = exportCampaign("test-campaign", summary, rows);
  assert.equal(result.complete, false);
  assert.equal(result.attempts[0].status, "token_delivered");
  assert.equal(result.attempts[0].accepted_ms, null);
  assert.doesNotMatch(JSON.stringify(result), /private/);
  const cells = campaignCells(result);
  assert.equal(cells.reduce((sum, cell) => sum + cell.not_run, 0), 2);
  assert.equal(cells.find(cell => cell.type === "hcaptcha")!.token_delivered, 1);
  assert.equal(cells.find(cell => cell.type === "hcaptcha")!.verified, 0);
});

test("publication refuses mixed protocols, duplicated attempts and fabricated coverage", () => {
  const { summary, rows } = evidence();
  assert.throws(() => exportCampaign("../escape", summary, rows), /ID/);
  assert.throws(() => exportCampaign("test", { ...summary, complete: true }, rows), /completion/);
  assert.throws(() => exportCampaign("test", summary, [...rows, ...rows]), /Duplicate/);
  assert.throws(() => exportCampaign("test", summary, [{ ...rows[0], status: "verified", accepted_ms: 1500 }]), /interchanged/);
  assert.throws(() => exportCampaign("test", { ...summary, configuration: { ...summary.configuration, version: 1 } }, rows), /protocol/);
  assert.throws(() => exportCampaign("test", { ...summary, configuration: { ...summary.configuration, solveTimeoutMs: 999 } }, rows), /drift/);
  assert.throws(() => exportCampaign("test", summary, [{ ...rows[0], token_ms: Infinity }]), /duration/);
  const result = exportCampaign("test", summary, rows);
  assert.throws(() => validateCampaign({ ...result, attempts: [{ ...result.attempts[0], round: 2 }] }), /unplanned/);
});

test("export writes a separate public file and never overwrites an earlier campaign", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "captcha-export-"));
  try {
    const { summary, rows } = evidence();
    await fs.writeFile(path.join(directory, "summary.json"), JSON.stringify(summary));
    await fs.writeFile(path.join(directory, "attempts.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    const destination = path.join(directory, "public");
    const file = await exportFiles(directory, "test", destination);
    assert.doesNotMatch(await fs.readFile(file, "utf8"), /private/);
    await assert.rejects(exportFiles(directory, "test", destination), /EEXIST/);
    await fs.writeFile(path.join(directory, "attempts.jsonl"), "corrupted line\n");
    await assert.rejects(exportFiles(directory, "corrupted", destination));
    assert.deepEqual(await fs.readdir(destination), ["test.json"]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
