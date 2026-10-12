import type { ProxyGetStats } from "./proxy-get";
import { sortRanked } from "./ranking";

export interface ProxyValueWeights { latency: number; reliability: number; cost: number }

// Fixed anchors keep a provider's score stable when competitors appear/disappear.
// Costs are per successful GET, including the cost of failed attempts.
export const PROXY_VALUE_ANCHORS = { latencyMs: 30_000, costPerSuccessUsd: 0.05 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

export function proxyValueScore(provider: ProxyGetStats, weights: ProxyValueWeights): number | null {
  if (provider.status !== "measured" || provider.attempts <= 0 || provider.successes <= 0) return null;
  const sum = weights.latency + weights.reliability + weights.cost;
  const normalized = sum > 0 ? {
    latency: weights.latency / sum, reliability: weights.reliability / sum, cost: weights.cost / sum,
  } : { latency: 1 / 3, reliability: 1 / 3, cost: 1 / 3 };
  if (normalized.latency > 0 && !valid(provider.medianGetMs)) return null;
  if (normalized.cost > 0 && !valid(provider.costPerSuccessUsd)) return null;
  const latency = valid(provider.medianGetMs) ? clamp(1 - provider.medianGetMs / PROXY_VALUE_ANCHORS.latencyMs) : 0;
  const reliability = clamp(provider.successes / provider.attempts);
  const cost = valid(provider.costPerSuccessUsd) ? clamp(1 - provider.costPerSuccessUsd / PROXY_VALUE_ANCHORS.costPerSuccessUsd) : 0;
  return normalized.latency * latency + normalized.reliability * reliability + normalized.cost * cost;
}

export function rankProxyValues(providers: ProxyGetStats[], weights: ProxyValueWeights) {
  const scores = new Map(providers.map(p => [p.provider, proxyValueScore(p, weights)]));
  const sorted = sortRanked(providers, p => scores.get(p.provider) != null,
    (a, b) => scores.get(b.provider)! - scores.get(a.provider)! || a.displayName.localeCompare(b.displayName),
    // Unscored rows: measured-but-failed first, unsupported last.
    (a, b) => Number(a.status === "unsupported") - Number(b.status === "unsupported") || a.displayName.localeCompare(b.displayName));
  const ranks = new Map<string, number>();
  let rank = 1;
  sorted.forEach((provider, index) => {
    if (scores.get(provider.provider) == null) return;
    if (index > 0 && scores.get(provider.provider) !== scores.get(sorted[index - 1].provider)) rank = index + 1;
    ranks.set(provider.provider, rank);
  });
  return { sorted, scores, ranks };
}
