import type { ProxyGetStats } from "./proxy-get";

// scripts/run-proxy-and-publish.sh publishes cumulative targets 10..50.
export function proxyRunCountLabel(provider: ProxyGetStats): string {
  const count = provider.attempts.toLocaleString("en-US");
  // Scheduled IDs keep the start date even if the suite finishes after midnight.
  const runId = provider.samples[0]?.run_id ?? "";
  const daily = /^daily-proxy-\d{4}-\d{2}-\d{2}$/.test(runId) && provider.samples.every(sample => sample.run_id === runId);
  return daily && provider.status === "measured" ? `${count}/50` : count;
}
