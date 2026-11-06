import test from "node:test";
import assert from "node:assert/strict";
import { campaignCells, type CaptchaType, type PublicAttempt, type PublicCampaign } from "../../src/benchmarks/captcha/publication";
import { captchaTypes } from "../../src/benchmarks/captcha/protocol.mjs";
import { CAPTCHA_PROVIDERS, captchaProviderNotes } from "./captcha-data";
import { captchaColumns, captchaLeaderboard } from "./captcha-leaderboard";

const attempt = (provider: string, type: string, status: PublicAttempt["status"], ms: number | null = null): PublicAttempt => ({
  id: `r01-${provider}-${type}`, provider, type, round: 1, stage: status === "error" ? "create" : "solve", status,
  accepted_ms: status === "verified" ? ms : null, token_ms: status === "token_delivered" ? ms : null,
  passed_ms: status === "page_passed" ? ms : null, cleanup_failed: false,
});
const campaign = (attempts: PublicAttempt[], protocol_version: 3 | 4 = 3): PublicCampaign => ({
  benchmark: "captcha", schema_version: 1, protocol_version, types: captchaTypes(protocol_version) as CaptchaType[], id: "ranking", started_at: "2026-11-04T00:00:00.000Z",
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
  const columns = captchaColumns(data);
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

test("benchmarked providers missing from a run get a note row after the ranked ones", () => {
  const data = campaign([attempt("notte", "turnstile", "verified", 5000)]);
  const cells = campaignCells(data);
  const columns = captchaColumns(data);
  const notes = captchaProviderNotes(data, [data]);
  // Every benchmarked provider outside this run gets a note; run providers never do.
  assert.deepEqual(Object.keys(notes).sort(), CAPTCHA_PROVIDERS.filter(provider => !data.providers.includes(provider)).sort());
  const rows = captchaLeaderboard(data, cells, columns, { "aws-agentcore": "AgentCore has no native solver", hyperbrowser: "ignored" },
    { ...notes, tilion: "No results yet: test", hyperbrowser: "never shown: unsupported wins" });
  const order = rows.map(row => row.provider);
  assert.equal(order[0], "notte");
  const tilion = rows.find(row => row.provider === "tilion")!;
  assert.equal(tilion.rank, null); assert.equal(tilion.note, "No results yet: test"); assert.equal(tilion.unsupportedReason, undefined);
  assert.equal(tilion.name, "Tilion");
  assert.ok(order.indexOf("tilion") > order.indexOf("browser-use"), "after providers of this run");
  assert.ok(order.indexOf("tilion") < order.indexOf("aws-agentcore"), "before providers without a solver");
  assert.equal(rows.filter(row => row.provider === "hyperbrowser").length, 1);
  assert.equal(rows.find(row => row.provider === "hyperbrowser")!.note, undefined);
  // A provider some other published run includes is "Not in this run", not "No results yet".
  const later = { providers: ["anchorbrowser"] };
  assert.match(captchaProviderNotes(data, [data, later]).anchorbrowser, /^Not in this run/);
  assert.match(captchaProviderNotes(data, [data]).anchorbrowser, /^No results yet/);
});

test("v4 columns come from the campaign and page passes count with their own timing", () => {
  const data = campaign([attempt("notte", "perimeterx", "page_passed", 4000), attempt("notte", "text", "rejected"),
    attempt("steel", "perimeterx", "timeout")], 4);
  const cells = campaignCells(data);
  const columns = captchaColumns(data);
  assert.deepEqual(columns.map(column => column.id), ["turnstile", "recaptcha", "hcaptcha", "recaptcha-v3", "geetest", "text", "perimeterx"]);
  assert.deepEqual(columns.slice(-2).map(column => [column.signal, column.signal_label]), [["page_check", "Page check"], ["page_reached", "Page reached"]]);
  const rows = captchaLeaderboard(data, cells, columns, {});
  const notte = rows.find(row => row.provider === "notte")!;
  assert.equal(notte.rank, 1);
  assert.deepEqual([notte.successes, notte.attempted, notte.medianMs], [1, 2, 4000]);
  const perimeterx = notte.results[columns.findIndex(column => column.id === "perimeterx")];
  assert.deepEqual([perimeterx.successes, perimeterx.medianMs], [1, 4000]);
  assert.deepEqual(perimeterx.rounds.map(round => round.label), ["Round 1: Passed"]);
  assert.equal(rows.find(row => row.provider === "steel")!.rank, 2);
});
