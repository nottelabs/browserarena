/**
 * The Value Score: one 0-1 number per provider from latency, reliability and
 * cost, each normalised with fixed anchors (see the README for why fixed
 * anchors beat ratio-to-best and min-max). Pure, so the leaderboard and the
 * tests share it.
 */

import type { ProviderStats } from "./data-shared";

export interface ValueWeights {
  latency: number;
  reliability: number;
  cost: number;
}

export const VALUE_ANCHORS = {
  latency: { floor: 10_000, ceiling: 0 },
  reliability: { floor: 90, ceiling: 100 },
  cost: { floor: 0.2, ceiling: 0 },
};

/**
 * Share of the latency dimension carried by the p95 tail. A great median with
 * a long tail is dangerous for anything that runs for hours: the tail is what
 * you actually pay. The rest is the percentile the viewer selected.
 */
export const TAIL_SHARE = 0.3;

export const DEFAULT_WEIGHTS: ValueWeights = { latency: 1 / 3, reliability: 1 / 3, cost: 1 / 3 };

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function normalizeLatency(ms: number): number {
  const { floor, ceiling } = VALUE_ANCHORS.latency;
  const range = floor - ceiling;
  return range > 0 ? clamp01((floor - ms) / range) : 1;
}

/** Latency blended with its p95 tail, both normalised against the same anchors. */
export function latencyScore(selectedMs: number, tailMs: number | null | undefined): number {
  const head = normalizeLatency(selectedMs);
  if (tailMs == null || !Number.isFinite(tailMs)) return head;
  return (1 - TAIL_SHARE) * head + TAIL_SHARE * normalizeLatency(tailMs);
}

type Scorable = Pick<ProviderStats, "provider" | "successRate" | "pricePerHour" | "p95TotalMs"> &
  Partial<Pick<ProviderStats, "totalTimeMs" | "p90TotalMs" | "p99TotalMs">>;

export function computeValueScores(
  providers: Scorable[],
  totalKey: keyof ProviderStats,
  weights: ValueWeights
): Map<string, number> {
  const scores = new Map<string, number>();
  if (providers.length === 0) return scores;

  const total = weights.latency + weights.reliability + weights.cost;
  const wLat = total > 0 ? weights.latency / total : 1 / 3;
  const wRel = total > 0 ? weights.reliability / total : 1 / 3;
  const wCost = total > 0 ? weights.cost / total : 1 / 3;

  const { reliability: relA, cost: costA } = VALUE_ANCHORS;
  const relRange = relA.ceiling - relA.floor;
  const costRange = costA.floor - costA.ceiling;

  for (const p of providers) {
    // No successful runs means no latency to score; leave the provider unscored.
    if (!(p.successRate > 0)) continue;
    const selected = (p as Record<string, unknown>)[totalKey];
    const lat = typeof selected === "number" ? selected : VALUE_ANCHORS.latency.floor;
    const rel = p.successRate;
    const cost = p.pricePerHour;

    const normLat = latencyScore(lat, p.p95TotalMs);
    const normRel = relRange > 0 ? clamp01((rel - relA.floor) / relRange) : 1;
    const normCost = cost != null && costRange > 0 ? clamp01((costA.floor - cost) / costRange) : 0;

    scores.set(p.provider, wLat * normLat + wRel * normRel + wCost * normCost);
  }

  return scores;
}
