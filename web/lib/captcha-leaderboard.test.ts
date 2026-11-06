import test from "node:test";
import assert from "node:assert/strict";
import { campaignCells, type PublicAttempt, type PublicCampaign } from "../../src/benchmarks/captcha/publication";
import { CAPTCHA_TYPES } from "./captcha-data";
import { captchaColumns, captchaLeaderboard } from "./captcha-leaderboard";

const attempt = (provider: string, type: string, status: PublicAttempt["status"], ms: number | null = null): PublicAttempt => ({
  id: `r01-${provider}-${type}`, provider, type, round: 1, stage: status === "error" ? "create" : "solve", status,
  accepted_ms: status === "verified" ? ms : null, token_ms: status === "token_delivered" ? ms : null, cleanup_failed: false,
});
const campaign = (attempts: PublicAttempt[]): PublicCampaign => ({
  benchmark: "captcha", schema_version: 1, protocol_version: 3, id: "ranking", started_at: "2026-11-04T00:00:00.000Z",
  finished_at: "2026-11-04T00:10:00.000Z", revision: "a".repeat(40), providers: ["kernel", "steel", "notte", "browser-use"],
  rounds: 1, concurrency: 1, complete: false, halted: false, interrupted: true, attempts,
});

test("CAPTCHA leaderboard ranks by overall success, then median time, keeping errors in the denominator", () => {
  const data = campaign([
    attempt("kernel", "turnstile", "verified", 9000), attempt("kernel", "recaptcha", "verified", 9000), attempt("kernel", "hcaptcha", "error"),
    attempt("steel", "turnstile", "verified", 2000), attempt("steel", "recaptcha", "verified", 2000), attempt("steel", "hcaptcha", "timeout"),
    attempt("notte", "turnstile", "verified", 5000), attempt("notte", "recaptcha", "verified", 5000), attempt("notte", "hcaptcha", "token_delivered", 5000),
  ]);
  const cells = campaignCells(data);
  const columns = captchaColumns(cells, CAPTCHA_TYPES);
  assert.deepEqual(columns.map(column => column.id), ["turnstile", "recaptcha", "hcaptcha"]);
  const rows = captchaLeaderboard(data, cells, columns, { "aws-agentcore": "AgentCore has no native solver", steel: "ignored: Steel has results" });
  assert.deepEqual(rows.map(row => [row.provider, row.rank]), [["notte", 1], ["steel", 2], ["kernel", 3], ["browser-use", null], ["aws-agentcore", null]]);
  const kernel = rows.find(row => row.provider === "kernel")!;
  assert.equal(kernel.successes, 2);
  assert.equal(kernel.attempted, 3);
  assert.equal(kernel.name, "KERNEL");
  assert.ok(kernel.logo);
  assert.deepEqual(kernel.results.map(result => `${result.successes}/${result.attempted}`), ["1/1", "1/1", "0/1"]);
  assert.equal(rows.find(row => row.provider === "notte")!.results[2].medianMs, 5000);
  const unrun = rows.find(row => row.provider === "browser-use")!;
  assert.deepEqual(unrun.results[0].rounds.map(round => round.label), ["Not run"]);
  assert.equal(rows.at(-1)!.unsupportedReason, "AgentCore has no native solver");
  assert.equal(rows.at(-1)!.name, "AWS AgentCore");
});

test("CAPTCHA columns follow the campaign's types and fall back for types without metadata", () => {
  const cells = campaignCells(campaign([])).map(cell => cell.type === "hcaptcha" ? { ...cell, type: "geetest" } : cell);
  const columns = captchaColumns(cells, CAPTCHA_TYPES);
  assert.deepEqual(columns.map(column => [column.id, column.label, column.signal]), [
    ["turnstile", "Cloudflare Turnstile", "acceptance"], ["recaptcha", "reCAPTCHA v2", "acceptance"], ["geetest", "geetest", "acceptance"],
  ]);
});
