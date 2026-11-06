import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configuration } from "./protocol.mjs";
import { campaignCells, exportCampaign, validateCampaign } from "./publication.js";
import { exportFiles } from "./export.js";

// A protocol v3 campaign: hCaptcha on NopeCHA counted token delivery only.
function evidence() {
  const config = configuration({ version: 3, providers: ["kernel"], rounds: 1 });
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
  // A v3 plan relabelled as v4 has drifted fixtures and cannot be exported as either.
  assert.throws(() => exportCampaign("test", { ...summary, configuration: { ...summary.configuration, version: 4 } }, rows), /drift: fixtures/);
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

// A protocol v4 campaign covering one attempt of each success signal.
function v4Evidence() {
  const config = configuration({ providers: ["kernel"], rounds: 1 });
  const row = (type: string, status: string, timings: Record<string, number | null>) => ({ id: `r01-kernel-${type}`, provider: "kernel",
    type, round: 1, stage: "verify", status, accepted_ms: null, token_ms: null, passed_ms: null, ...timings,
    session_id: "private-session", cleanup: { released: true, disconnected: true }, verification: { score: 0.9 } });
  return { summary: { configuration: { ...config, started_at: "2026-11-06T00:00:00Z", browserarena_sha: "b".repeat(40) },
    finished_at: "2026-11-06T00:10:00Z", complete: false, halted: false, interrupted: false },
  rows: [row("hcaptcha", "verified", { accepted_ms: 9000, token_ms: 8000 }), row("recaptcha-v3", "verified", { accepted_ms: 3000 }),
    row("text", "page_passed", { passed_ms: 12000, token_ms: 10000 }), row("perimeterx", "page_passed", { passed_ms: 4000 }),
    row("geetest", "rejected", { token_ms: 7000 })] };
}

test("v4 exports carry typed columns and keep page checks apart from server acceptance", () => {
  const { summary, rows } = v4Evidence();
  const result = exportCampaign("v4-campaign", summary, rows);
  assert.equal(result.protocol_version, 4);
  assert.deepEqual(result.types.map(type => `${type.id}:${type.signal_label}`), ["turnstile:Server acceptance", "recaptcha:Server acceptance",
    "hcaptcha:Server acceptance", "recaptcha-v3:Server acceptance", "geetest:Server acceptance", "text:Page check", "perimeterx:Page reached"]);
  assert.doesNotMatch(JSON.stringify(result), /private|score/);
  const cells = campaignCells(result), cell = (type: string) => cells.find(c => c.type === type)!;
  assert.equal(cell("hcaptcha").succeeded, 1); assert.equal(cell("hcaptcha").token_delivered, 0);
  assert.equal(cell("text").succeeded, 1); assert.equal(cell("text").verified, 0); assert.equal(cell("text").success_median_ms, 12000);
  assert.equal(cell("perimeterx").signal, "page_reached");
  assert.equal(cell("geetest").rejected, 1); assert.equal(cells.reduce((sum, c) => sum + c.not_run, 0), 2);
  const swap = (type: string, change: Record<string, unknown>) => rows.map(r => r.type === type ? { ...r, ...change } : r);
  for (const [type, change, error] of [
    ["text", { status: "verified", accepted_ms: 12000 }, /interchanged/],
    ["perimeterx", { status: "token_delivered", token_ms: 4000, passed_ms: null }, /interchanged/],
    ["hcaptcha", { status: "token_delivered", accepted_ms: null }, /interchanged/],
    ["recaptcha-v3", { status: "page_passed", accepted_ms: null, passed_ms: 3000 }, /interchanged/],
    ["text", { passed_ms: null }, /missing its timing/],
    ["geetest", { passed_ms: 7000 }, /page timing/],
  ] as const) assert.throws(() => exportCampaign("v4-campaign", summary, swap(type, change)), error);
});

test("published v3 campaigns still validate with their three columns and token delivery", async () => {
  const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../results/captcha/2026-11-04-west-v3.json");
  const campaign = validateCampaign(JSON.parse(await fs.readFile(file, "utf8")));
  assert.equal(campaign.protocol_version, 3);
  assert.deepEqual(campaign.types.map(type => type.signal_label), ["Server acceptance", "Server acceptance", "Token delivery only"]);
  const hcaptcha = campaignCells(campaign).filter(cell => cell.type === "hcaptcha");
  assert.ok(hcaptcha.every(cell => cell.succeeded === cell.token_delivered && cell.verified === 0));
  assert.ok(campaign.attempts.every(attempt => attempt.passed_ms === null));
});
