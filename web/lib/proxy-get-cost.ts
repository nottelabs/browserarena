import type { ProxyGetRecord } from "../../src/benchmarks/proxy-get/schema";

export function proxyAttemptCost(sample: ProxyGetRecord) {
  return sample.cost_reconciliation ?? sample;
}

export function proxyCostExplanation(samples: ProxyGetRecord[]): string {
  const attempts = samples.filter(s => s.status !== "unsupported");
  const unknown = attempts.filter(s => proxyAttemptCost(s).cost_usd === null);
  const reasons: string[] = [];
  if (unknown.some(s => !s.pricing)) reasons.push("Pricing is not configured.");
  if (unknown.some(s => s.pricing?.proxyPerGbUsd === null)) {
    reasons.push(attempts[0]?.provider === "TILION"
      ? "The configured Tilion account meters egress at 1 credit/MB and session creation at 2 credits, but a credit-to-USD conversion is unverified."
      : "The proxy bandwidth rate is unverified.");
  }
  const launches = unknown.filter(s => s.error_stage === "session_create").length;
  if (launches) reasons.push(`${launches} failed ${launches === 1 ? "launch has" : "launches have"} no confirmed billable duration or charge.`);
  if (unknown.some(s => s.cleanup_error)) reasons.push("Session cleanup failed; the final billable duration is unknown.");
  if (unknown.length) {
    const browser = attempts.reduce((sum, s) => sum + (proxyAttemptCost(s).browser_cost_usd ?? 0), 0);
    if (browser > 0) reasons.push(`Known browser-time estimate: $${browser.toFixed(6)}; this is not the total run cost.`);
    if (!reasons.length) reasons.push("Final usage is unavailable for one or more attempts.");
  }
  const reconciliation = attempts.find(s => s.cost_reconciliation)?.cost_reconciliation;
  if (reconciliation) reasons.push(reconciliation.note);
  const estimateNote = attempts.map(s => proxyAttemptCost(s).pricing?.estimateNote).find(Boolean);
  if (!reconciliation && estimateNote) reasons.push(estimateNote);
  if (!unknown.length && !reconciliation && !estimateNote) reasons.push("Estimated list-price usage before subscriptions and included credits.");
  return reasons.join(" ");
}
