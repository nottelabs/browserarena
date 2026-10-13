import type { ProxyGetStats } from "./proxy-get";

// scripts/run-proxy-and-publish.sh publishes cumulative targets 10..50.
export function proxyRunCountLabel(provider: ProxyGetStats): string {
  const count = provider.attempts.toLocaleString("en-US");
  const daily = provider.samples.length > 0 && provider.samples.every(sample => sample.run_id === `daily-proxy-${provider.runDate}`);
  return daily && provider.status === "measured" ? `${count}/50` : count;
}
