import test from "node:test";
import assert from "node:assert/strict";
import type { ProxyGetStats } from "./proxy-get";
import { proxyValueScore, rankProxyValues } from "./proxy-value-score";

const fastest = { latency: 100, reliability: 0, cost: 0 };
const cheapest = { latency: 0, reliability: 0, cost: 100 };
const balanced = { latency: 33, reliability: 33, cost: 33 };
const mostReliable = { latency: 5, reliability: 90, cost: 5 };
const provider = (id: string, fields: Partial<ProxyGetStats> = {}): ProxyGetStats => ({
  provider: id, displayName: id, url: "https://example.com", country: "US", runDate: "2026-10-12",
  browserRegion: "us-east-1", status: "measured", attempts: 10, successes: 10,
  medianGetMs: 3000, medianFirstByteMs: 100, minGetMs: 3000, maxGetMs: 3000, medianMbps: 3,
  totalCostUsd: 0.05, costPerSuccessUsd: 0.005, estimatedTraffic: true, costExplanation: "Estimate", samples: [],
  ...fields,
});

test("fixed anchors and normalized weights produce a bounded score", () => {
  const p = provider("a");
  assert.equal(proxyValueScore(p, fastest), 0.9);
  assert.equal(proxyValueScore(p, cheapest), 0.9);
  assert.ok(Math.abs(proxyValueScore(p, balanced)! - (0.9 + 1 + 0.9) / 3) < 1e-12);
  assert.equal(proxyValueScore(p, { latency: 0, reliability: 0, cost: 0 }), proxyValueScore(p, balanced));
  assert.equal(proxyValueScore(provider("b", { medianGetMs: 60_000 }), fastest), 0);
  assert.equal(proxyValueScore(provider("b", { costPerSuccessUsd: 0.05 }), cheapest), 0);
  assert.equal(proxyValueScore(provider("b", { costPerSuccessUsd: 0 }), cheapest), 1);
});

test("missing cost is allowed only when cost has no weight", () => {
  const p = provider("unknown", { costPerSuccessUsd: null });
  assert.equal(proxyValueScore(p, fastest), 0.9);
  assert.equal(proxyValueScore(p, cheapest), null);
  assert.equal(proxyValueScore(p, balanced), null);
  assert.equal(proxyValueScore(p, mostReliable), null);
});

test("failed and unsupported providers cannot win any preset", () => {
  for (const weights of [fastest, cheapest, balanced, mostReliable]) {
    const failed = provider("failed", { successes: 0, medianGetMs: 0, costPerSuccessUsd: 0 });
    const unavailable = provider("unavailable", { status: "unsupported", attempts: 0 });
    const ranked = rankProxyValues([unavailable, failed, provider("working")], weights);
    assert.equal(ranked.sorted[0].provider, "working");
    assert.equal(ranked.scores.get("failed"), null);
    assert.equal(ranked.scores.get("unavailable"), null);
    assert.equal(ranked.ranks.has("failed"), false);
  }
});

test("reliability preset rewards completion over faster partial success", () => {
  const quick = provider("quick", { successes: 4, medianGetMs: 100 });
  const reliable = provider("reliable", { medianGetMs: 10_000 });
  assert.equal(rankProxyValues([quick, reliable], fastest).sorted[0].provider, "quick");
  assert.equal(rankProxyValues([quick, reliable], mostReliable).sorted[0].provider, "reliable");
});

test("cost per success includes failures and controls the cheapest ranking", () => {
  const cheapRun = provider("cheap-run", { totalCostUsd: 0.01, successes: 1, costPerSuccessUsd: 0.01 });
  const cheapSuccess = provider("cheap-success", { totalCostUsd: 0.05, costPerSuccessUsd: 0.005 });
  assert.equal(rankProxyValues([cheapRun, cheapSuccess], cheapest).sorted[0].provider, "cheap-success");
});

test("ties share ranks and missing weighted metrics remain last", () => {
  const rows = [provider("unknown", { costPerSuccessUsd: null }), provider("z"), provider("a"), provider("slow", { medianGetMs: 10_000 })];
  const before = rows.map(p => p.provider);
  const { sorted, ranks } = rankProxyValues(rows, balanced);
  assert.deepEqual(sorted.map(p => p.provider), ["a", "z", "slow", "unknown"]);
  assert.deepEqual([...ranks], [["a", 1], ["z", 1], ["slow", 3]]);
  assert.deepEqual(rows.map(p => p.provider), before);
  assert.equal(proxyValueScore(rows[1], balanced), proxyValueScore(sorted[0], balanced));
});

test("non-finite weighted measurements do not become numeric scores", () => {
  assert.equal(proxyValueScore(provider("a", { medianGetMs: NaN }), fastest), null);
  assert.equal(proxyValueScore(provider("a", { medianGetMs: null }), fastest), null);
  assert.equal(proxyValueScore(provider("a", { costPerSuccessUsd: Infinity }), cheapest), null);
});
