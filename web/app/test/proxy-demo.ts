import { loadProxyGetHistory, summarizeProxyGetHistory } from "@/lib/proxy-get-history";
import type { ProxyGetRecord } from "@/lib/proxy-get";
import { proxyAttemptCost } from "@/lib/proxy-get-cost";

/** Preview-only data, generated in memory; recorded result files are never changed. */
export function simulateProxyHistory(samples: ProxyGetRecord[], anchorDate: string) {
  const start = Date.parse(`${anchorDate}T00:00:00Z`) - 13 * 86_400_000;
  const providers = [...new Set(samples.map(s => s.provider))].sort();
  return Array.from({ length: 14 }, (_, day) => {
    const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
    return samples.map((sample, index): ProxyGetRecord => {
      const provider = providers.indexOf(sample.provider);
      const drift = 1.08 - day * 0.008 + Math.sin(day * 0.75 + provider * 1.1) * 0.14;
      const spike = day === 8 && provider % 3 === 0 ? 1.45 : 1;
      const variation = 1 + Math.sin(index * 1.9 + day * 0.8) * 0.08;
      const factor = Math.min(drift * spike * variation, sample.get_ms && sample.get_ms > 0 ? sample.timeout_ms * 0.96 / sample.get_ms : Infinity);
      const costFactor = 1 + Math.sin(day * 0.65 + provider) * 0.12;
      const scale = (value: number | null, multiplier = factor) => value === null ? null : Math.round(value * multiplier * 1000) / 1000;
      const get = sample.status === "success" ? scale(sample.get_ms) : null;
      const firstByte = sample.status === "success" ? scale(sample.first_byte_ms, drift * variation) : null;
      const estimate = proxyAttemptCost(sample);
      return { ...sample, run_id: `simulated-${date}`, created_at: `${date}T12:00:00Z`, session_id: null,
        get_ms: get, first_byte_ms: firstByte === null || get === null ? null : Math.min(firstByte, get),
        headers_ms: sample.status === "success" ? scale(sample.headers_ms) : null,
        pricing: estimate.pricing, cost_reconciliation: undefined,
        transfer_bytes: estimate.transfer_bytes, transfer_bytes_source: estimate.transfer_bytes_source,
        browser_cost_usd: estimate.browser_cost_usd === null ? null : estimate.browser_cost_usd * costFactor,
        proxy_cost_usd: estimate.proxy_cost_usd === null ? null : estimate.proxy_cost_usd * costFactor,
        cost_usd: estimate.cost_usd === null ? null : estimate.cost_usd * costFactor,
        error_message: sample.status === "failed" ? "Simulated failed download for layout preview" : null,
        cleanup_error: null, usage_error: null, infrastructure_note: undefined,
      };
    });
  }).flat();
}

export async function loadTestProxyHistory(country: string, date?: string, simulated = true) {
  const recorded = await loadProxyGetHistory(country, simulated ? undefined : date);
  if (!simulated || !recorded.selectedDate) return recorded;
  const samples = recorded.selected.providers.flatMap(p => p.samples);
  if (!samples.length) return recorded;
  return summarizeProxyGetHistory(simulateProxyHistory(samples, recorded.selectedDate), country, date);
}
