import assert from "node:assert/strict";
import test from "node:test";
import { parseProxyGetJsonl, summarizeProxyGet, type ProxyGetRecord } from "./proxy-get";
import { DEFAULT_PROXY_PRICING } from "../../src/benchmarks/proxy-get/pricing";

function entry(overrides: Partial<ProxyGetRecord> = {}): ProxyGetRecord {
  return { benchmark: "proxy-get", version: 1, provider: "STEEL", country: "FR", run_id: "suite-1",
    created_at: "2026-10-08T10:00:00Z", url: "https://target.example/payload", bootstrap_url: "https://target.example/bootstrap",
    country_verification_url: "https://api.country.is", expected_bytes: 1_000_000, expected_sha256: "a".repeat(64), timeout_ms: 30000,
    connection_mode: "warm-origin-fresh-session", proxy_type: "residential", browser_region: "us-east-1",
    status: "success", get_ms: 100, first_byte_ms: 25, cost_usd: 0.01, transfer_bytes_source: "provider",
    bytes_received: 1_000_000, ...overrides } as ProxyGetRecord;
}

test("failed attempts count toward reliability and cost but not successful latency", () => {
  const summary = summarizeProxyGet([entry(), entry({ get_ms: 300, cost_usd: 0.03 }),
    entry({ status: "failed", get_ms: 1, cost_usd: 0.02 })], "FR").providers[0];
  assert.equal(summary.attempts, 3);
  assert.equal(summary.successes, 2);
  assert.equal(summary.medianGetMs, 200);
  assert.equal(summary.totalCostUsd, 0.06);
  assert.equal(summary.costPerSuccessUsd, 0.03);
});
test("unknown attempt cost propagates to the total rather than implying a discount", () => {
  const summary = summarizeProxyGet([entry(), entry({ status: "failed", cost_usd: null })], "FR").providers[0];
  assert.equal(summary.totalCostUsd, null);
  assert.equal(summary.costPerSuccessUsd, null);
});
test("dated reconciliation supplies the estimate while preserving original sample fields", () => {
  const original = entry({ provider: "BROWSERBASE", cost_usd: null, pricing: { ...DEFAULT_PROXY_PRICING.BROWSERBASE, proxyPerGbUsd: null },
    transfer_bytes: 1_049_000, transfer_bytes_source: "browser-observed",
    cost_reconciliation: { checked_at: "2026-10-11T20:00:00Z", note: "Developer rates; account plan unconfirmed",
      pricing: DEFAULT_PROXY_PRICING.BROWSERBASE, transfer_bytes: 1_080_000, transfer_bytes_source: "provider",
      browser_cost_usd: 0.002, proxy_cost_usd: 0.024, cost_usd: 0.026 } });
  const summary = summarizeProxyGet([original], "FR").providers[0];
  assert.equal(summary.totalCostUsd, 0.026);
  assert.equal(summary.costPerSuccessUsd, 0.026);
  assert.equal(summary.estimatedTraffic, false);
  assert.match(summary.costExplanation, /account plan unconfirmed/);
  assert.equal(summary.samples[0].cost_usd, null);
  assert.equal(summary.samples[0].transfer_bytes_source, "browser-observed");
  assert.equal(summary.samples[0].pricing?.proxyPerGbUsd, null);
  const withFailure = summarizeProxyGet([original, entry({ provider: "BROWSERBASE", status: "failed", cost_usd: null, error_stage: "session_create" })], "FR").providers[0];
  assert.equal(withFailure.totalCostUsd, null);
});
test("Tilion unknown costs explain credits, failed launches, and the partial browser estimate", () => {
  const summary = summarizeProxyGet([
    entry({ provider: "TILION", cost_usd: null, browser_cost_usd: 0.0001, pricing: { ...DEFAULT_PROXY_PRICING.TILION, proxyPerGbUsd: null } }),
    entry({ provider: "TILION", status: "failed", cost_usd: null, browser_cost_usd: null, pricing: { ...DEFAULT_PROXY_PRICING.TILION, proxyPerGbUsd: null }, error_stage: "session_create" }),
  ], "FR").providers[0];
  assert.equal(summary.totalCostUsd, null);
  assert.match(summary.costExplanation, /credit-to-USD conversion/);
  assert.match(summary.costExplanation, /1 failed launch/);
  assert.match(summary.costExplanation, /\$0\.000100/);
});
test("Tilion inferred pricing is explained in the UI, including the failed-launch assumption", () => {
  const summary = summarizeProxyGet([
    entry({ provider: "TILION", pricing: DEFAULT_PROXY_PRICING.TILION, cost_usd: 0.001, browser_cost_usd: 0.0006 }),
    entry({ provider: "TILION", pricing: DEFAULT_PROXY_PRICING.TILION, status: "failed", error_stage: "session_create", cost_usd: 0.0004, browser_cost_usd: 0.0004 }),
  ], "FR").providers[0];
  assert.equal(summary.totalCostUsd, 0.0014);
  assert.equal(summary.costPerSuccessUsd, 0.0014);
  assert.match(summary.costExplanation, /\$0\.20\/GB/);
  assert.match(summary.costExplanation, /Failed launches are budgeted/);
  assert.doesNotMatch(summary.costExplanation, /conversion is unverified/);
});
test("latest suite replaces older successes even when new requests all fail", () => {
  const summary = summarizeProxyGet([entry(), entry({ created_at: "2026-10-08T11:00:00Z", run_id: "suite-2", status: "failed" })], "FR").providers[0];
  assert.equal(summary.attempts, 1);
  assert.equal(summary.successes, 0);
  assert.equal(summary.medianGetMs, null);
  assert.equal(summary.costPerSuccessUsd, null);
});
test("different payloads, timeouts, and countries are not pooled", () => {
  const summary = summarizeProxyGet([entry({ timeout_ms: 20000 }), entry({ url: "https://other.example/payload" }),
    entry({ country: "US" }), entry({ created_at: "2026-10-08T11:00:00Z" })], "FR").providers[0];
  assert.equal(summary.attempts, 1);
});
test("a newer country-only suite never resurrects older results for another country", () => {
  const result = summarizeProxyGet([entry(), entry({ country: "US", created_at: "2026-10-08T11:00:00Z", run_id: "suite-2" })], "FR");
  assert.equal(result.providers.length, 0);
});
test("unsupported combinations have no fake failed attempts", () => {
  const summary = summarizeProxyGet([entry({ status: "unsupported", get_ms: null, cost_usd: null })], "FR").providers[0];
  assert.equal(summary.status, "unsupported");
  assert.equal(summary.attempts, 0);
});
test("selected country reports its browser region rather than the last shuffled country's region", () => {
  const summary = summarizeProxyGet([
    entry({ provider: "TILION", country: "US", browser_region: "requested-region:us" }),
    entry({ provider: "TILION", country: "JP", browser_region: "requested-region:jp", created_at: "2026-10-08T11:00:00Z" }),
  ], "US").providers[0];
  assert.equal(summary.browserRegion, "requested-region:us");
});
test("JSONL loading skips malformed and unrelated benchmark rows", () => {
  const parsed = parseProxyGetJsonl([JSON.stringify(entry()), "{", "null", JSON.stringify({ benchmark: "hello-browser" }), ""].join("\n"));
  assert.equal(parsed.length, 1);
});
