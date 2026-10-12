import assert from "node:assert/strict";
import test from "node:test";
import { simulateProxyHistory } from "../app/test/proxy-demo";
import { summarizeProxyGetHistory } from "./proxy-get-history";
import type { ProxyGetRecord } from "./proxy-get";
import { DEFAULT_PROXY_PRICING } from "../../src/benchmarks/proxy-get/pricing";

test("preview generates fourteen deterministic days without changing recorded samples or filling unknown cost", () => {
  const base = { benchmark: "proxy-get", version: 1, provider: "STEEL", country: "US", run_id: "recorded",
    created_at: "2026-10-08T10:00:00Z", url: "https://target.example/payload", expected_bytes: 1048576,
    timeout_ms: 30000, status: "success", get_ms: 2000, first_byte_ms: 800, headers_ms: 900,
    cost_usd: null, browser_cost_usd: null, proxy_cost_usd: null, bytes_received: 1048576 } as ProxyGetRecord;
  const failed = { ...base, status: "failed", get_ms: null, first_byte_ms: null } as ProxyGetRecord;
  const samples = [base, failed];
  const original = JSON.stringify(samples);
  const simulated = simulateProxyHistory(samples, "2026-10-08");
  assert.equal(JSON.stringify(samples), original);
  assert.deepEqual(simulated, simulateProxyHistory(samples, "2026-10-08"));
  const history = summarizeProxyGetHistory(simulated, "US", "2026-10-01");
  assert.equal(history.dates.length, 14);
  assert.equal(history.dates[0], "2026-09-25");
  assert.equal(history.selectedDate, "2026-10-01");
  assert.equal(history.selected.providers[0].attempts, 2);
  assert.equal(history.selected.providers[0].successes, 1);
  assert.equal(history.selected.providers[0].costPerSuccessUsd, null);
  assert.ok(new Set(history.days.map(d => d.providers[0].medianGetMs)).size > 1);
  assert.ok(simulated.every(s => s.get_ms === null || s.get_ms <= s.timeout_ms));
});
test("simulations vary reconciled costs without claiming actual provider reconciliation on simulated days", () => {
  const sample = { benchmark: "proxy-get", version: 1, provider: "BROWSERBASE", country: "US", run_id: "recorded",
    status: "success", get_ms: 2000, first_byte_ms: 800, headers_ms: 900, timeout_ms: 30000,
    cost_usd: null, browser_cost_usd: null, proxy_cost_usd: null,
    cost_reconciliation: { checked_at: "2026-10-11T20:00:00Z", note: "Actual provider counter",
      pricing: DEFAULT_PROXY_PRICING.BROWSERBASE, transfer_bytes: 1080000, transfer_bytes_source: "provider",
      browser_cost_usd: 0.002, proxy_cost_usd: 0.024, cost_usd: 0.026 },
  } as ProxyGetRecord;
  const simulated = simulateProxyHistory([sample], "2026-10-11");
  assert.ok(new Set(simulated.map(s => s.cost_usd)).size > 1);
  assert.ok(simulated.every(s => s.cost_reconciliation === undefined && s.cost_usd !== null));
  assert.equal(sample.cost_usd, null);
  assert.equal(sample.cost_reconciliation?.cost_usd, 0.026);
});
