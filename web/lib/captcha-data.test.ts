import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CAPTCHA_UNSUPPORTED_PROVIDERS, captchaColumns, cellSuccess, loadCaptchaCampaigns } from "./captcha-data";
import { campaignCells } from "../../src/benchmarks/captcha/publication";
import { PROVIDERS } from "../../src/benchmarks/captcha/protocol.mjs";

test("every site provider is either benchmarked or listed with a reason", () => {
  const site = ["kernel", "browserbase", "browser-use", "steel", "notte", "hyperbrowser", "anchorbrowser",
    "browserless", "tilion", "tinyfish", "aws-agentcore", "cloudflare", "lightpanda"];
  const unsupported = Object.keys(CAPTCHA_UNSUPPORTED_PROVIDERS);
  assert.deepEqual([...PROVIDERS, ...unsupported].sort(), [...site].sort());
  for (const reason of Object.values(CAPTCHA_UNSUPPORTED_PROVIDERS)) assert.match(reason, /has no CAPTCHA solving/);
});

test("CAPTCHA loader distinguishes no campaigns, partial campaigns, and invalid data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "captcha-data-"));
  const directory = path.join(root, "campaigns");
  try {
    assert.deepEqual(await loadCaptchaCampaigns(directory), []);
    await fs.mkdir(directory);
    const campaign = { benchmark: "captcha", schema_version: 1, protocol_version: 3, id: "partial",
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

test("CAPTCHA columns come from each campaign's protocol with their success-signal labels", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "captcha-columns-"));
  try {
    const base = { benchmark: "captcha", schema_version: 1, revision: "a".repeat(40), providers: ["kernel"], rounds: 1,
      concurrency: 1, complete: false, halted: false, interrupted: false };
    await fs.writeFile(path.join(root, "old.json"), JSON.stringify({ ...base, protocol_version: 3, id: "old",
      started_at: "2026-11-04T00:00:00Z", finished_at: "2026-11-04T00:01:00Z", attempts: [{ id: "r01-kernel-hcaptcha", provider: "kernel",
        type: "hcaptcha", round: 1, stage: "solve", status: "token_delivered", accepted_ms: null, token_ms: 900, cleanup_failed: false }] }));
    await fs.writeFile(path.join(root, "new.json"), JSON.stringify({ ...base, protocol_version: 4, id: "new",
      started_at: "2026-11-06T00:00:00Z", finished_at: "2026-11-06T00:01:00Z", attempts: [{ id: "r01-kernel-perimeterx", provider: "kernel",
        type: "perimeterx", round: 1, stage: "solve", status: "page_passed", accepted_ms: null, token_ms: null, passed_ms: 4000, cleanup_failed: false }] }));
    const [v4, v3] = await loadCaptchaCampaigns(root);
    assert.deepEqual(captchaColumns(v3).map(c => `${c.label}: ${c.signal_label}`),
      ["Cloudflare Turnstile: Server acceptance", "reCAPTCHA v2: Server acceptance", "hCaptcha: Token delivery only"]);
    assert.deepEqual(captchaColumns(v4).map(c => c.id), ["turnstile", "recaptcha", "hcaptcha", "recaptcha-v3", "geetest", "text", "perimeterx"]);
    assert.deepEqual(captchaColumns(v4).slice(-2).map(c => c.signal_label), ["Page check", "Page reached"]);
    assert.deepEqual(cellSuccess(campaignCells(v3).find(c => c.type === "hcaptcha")!), { count: 1, word: "delivered", median_ms: 900, interval_95: campaignCells(v3).find(c => c.type === "hcaptcha")!.success_interval_95 });
    const px = cellSuccess(campaignCells(v4).find(c => c.type === "perimeterx")!);
    assert.equal(px.count, 1); assert.equal(px.word, "reached"); assert.equal(px.median_ms, 4000);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
