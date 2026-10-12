import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PROXY_PRICING, estimateProxyAttemptCost, estimateProxyCost, loadProxyPricing } from "./pricing.js";
import { parseCountries } from "./schema.js";

test("minute billing, creation fees, and bandwidth are charged together", () => {
  const cost = estimateProxyCost(DEFAULT_PROXY_PRICING.ANCHORBROWSER, 61_000, 2_000_000);
  assert.equal(cost.browser_cost_usd, 0.01 + 0.05 / 30);
  assert.equal(cost.proxy_cost_usd, 0.016);
  assert.equal(cost.cost_usd, cost.browser_cost_usd! + cost.proxy_cost_usd!);
});
test("unknown proxy prices propagate; included proxies have explicit zero price", () => {
  assert.equal(estimateProxyCost({ ...DEFAULT_PROXY_PRICING.TILION, proxyPerGbUsd: null }, 1000, 1000).cost_usd, null);
  assert.equal(estimateProxyCost(DEFAULT_PROXY_PRICING.KERNEL, 1000, 1000).proxy_cost_usd, 0);
  assert.equal(estimateProxyCost(DEFAULT_PROXY_PRICING.STEEL, null, 1000).cost_usd, null);
});
test("Tilion inferred credit rates include traffic rounding and per-session fees", () => {
  const pricing = DEFAULT_PROXY_PRICING.TILION;
  const cost = estimateProxyCost(pricing, 1000, 1_048_576);
  assert.equal(pricing.proxyPerGbUsd, 0.2);
  assert.equal(cost.browser_cost_usd, 0.0004 + 0.03 / 3600);
  assert.equal(cost.proxy_cost_usd, 0.0004);
  assert.equal(cost.cost_usd, cost.browser_cost_usd! + cost.proxy_cost_usd!);
  const failed = { session_wall_ms: null, session_id: null, transfer_bytes: 0, error_stage: "session_create", cleanup_error: null };
  assert.equal(estimateProxyAttemptCost(pricing, failed).cost_usd, 0.0004);
  assert.equal(estimateProxyAttemptCost(DEFAULT_PROXY_PRICING.STEEL, failed).cost_usd, null);
  assert.equal(estimateProxyAttemptCost(pricing, { ...failed, session_id: "created" }).cost_usd, null);
  assert.equal(estimateProxyAttemptCost(pricing, { ...failed, error_stage: "get" }).cost_usd, null);
  assert.equal(estimateProxyAttemptCost(pricing, { ...failed, cleanup_error: "release failed" }).cost_usd, null);
});
test("Browserbase Developer rates include the browser minute and proxy MB minimum", () => {
  const cost = estimateProxyCost(DEFAULT_PROXY_PRICING.BROWSERBASE, 1000, 1000);
  assert.equal(cost.browser_cost_usd, 0.002);
  assert.equal(cost.proxy_cost_usd, 0.012);
  assert.equal(cost.cost_usd, 0.014);
});
test("session bandwidth minimums and increments apply before GB conversion", () => {
  const pricing = { ...DEFAULT_PROXY_PRICING.BROWSERBASE, proxyPerGbUsd: 10 };
  assert.equal(estimateProxyCost(pricing, 1000, 100).proxy_cost_usd, 0.01);
  assert.equal(estimateProxyCost(pricing, 1000, 1_000_001).proxy_cost_usd, 0.02);
});
test("pricing overrides are validated and retain provenance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-pricing-"));
  const file = path.join(dir, "pricing.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ STEEL: { proxyPerGbUsd: 6, plan: "Scale" } }));
    assert.equal(loadProxyPricing(file).STEEL.proxyPerGbUsd, 6);
    assert.equal(loadProxyPricing(file).STEEL.sourceUrls.length, 1);
    fs.writeFileSync(file, JSON.stringify({ STEEL: { proxyIncrementBytes: 0 } }));
    assert.throws(() => loadProxyPricing(file), /Invalid pricing/);
    fs.writeFileSync(file, JSON.stringify({ STEEL: { browserPerHourUsd: -1 } }));
    assert.throws(() => loadProxyPricing(file), /Invalid STEEL/);
    fs.writeFileSync(file, JSON.stringify({ TILION: { failedLaunchFeeUsd: -1 } }));
    assert.throws(() => loadProxyPricing(file), /Invalid pricing assumptions/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("country selection is explicit and deduplicated", () => {
  assert.deepEqual(parseCountries("fr,US,FR"), ["FR", "US"]);
  assert.throws(() => parseCountries("DE"), /countries/);
  assert.throws(() => parseCountries(""), /countries/);
});
