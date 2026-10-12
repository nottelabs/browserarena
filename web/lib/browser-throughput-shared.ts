/**
 * Agent-loop leaderboard shapes and the pure summary that builds them from
 * result records. Kept free of Node-only imports so client components and
 * tests can use it.
 */

export type AgentActionType =
  | "navigate"
  | "waitForSelector"
  | "screenshot"
  | "textContent"
  | "click"
  | "goBack";

export const AGENT_ACTION_TYPES: AgentActionType[] = [
  "navigate",
  "waitForSelector",
  "screenshot",
  "textContent",
  "click",
  "goBack",
];

export const AGENT_ACTION_LABELS: Record<AgentActionType, string> = {
  navigate: "Navigate",
  waitForSelector: "Wait",
  screenshot: "Screenshot",
  textContent: "Read",
  click: "Click",
  goBack: "Back",
};

export interface AgentActionEntry {
  index: number;
  loop: number;
  type: AgentActionType;
  duration_ms: number;
  success: boolean;
  error_message?: string | null;
  skipped?: boolean;
}

/** One line of `results/browser-throughput/<provider>/<date>/c<N>/results.jsonl`. */
export interface BrowserThroughputEntry {
  created_at: string;
  id: string | null;
  provider: string;
  concurrency?: number;
  warmup?: boolean;
  cold_start?: boolean;
  success: boolean;
  error_stage: string | null;
  error_message: string | null;
  session_creation_ms: number | null;
  session_connect_ms: number | null;
  session_release_ms: number | null;
  viewport_width?: number;
  viewport_height?: number;
  loops: number;
  actions_total: number;
  actions_completed: number;
  task_ms: number | null;
  actions_per_second: number | null;
  first_loop_ms?: number | null;
  last_loop_ms?: number | null;
  actions: AgentActionEntry[];
  cost_usd?: number | null;
  _runDate?: string;
}

export interface Triple {
  median: number;
  p95: number;
  p99: number;
  /** How many values the percentiles were taken over. Zero means "nothing to show", not "instant". */
  samples: number;
}

export interface BrowserThroughputProviderStats {
  provider: string;
  displayName: string;
  url: string;
  browserRegion?: string;
  runDate?: string;
  totalRuns: number;
  concurrency: number;
  loops: number;
  actionsPerSession: number;
  /** Sessions where every action succeeded, in percent. */
  successRate: number;
  /** Actions that succeeded across all sessions, in percent. */
  actionCompletionRate: number;
  actionsPerSecond: Triple;
  taskMs: Triple;
  createMs: Triple;
  perAction: Record<AgentActionType, Triple>;
  /** Median of (last loop / first loop) across sessions with more than one loop; null otherwise. */
  driftRatio: number | null;
  /** Cost of 1,000 actions at the median throughput on this provider's billing, or null without pricing. */
  costPer1kActionsUsd: number | null;
  pricePerHour: number | null;
  rank: number;
}

export interface BrowserThroughputLeaderboardResult {
  providers: BrowserThroughputProviderStats[];
  metadata: {
    dateRange?: { min: string; max: string };
    availableConcurrencyLevels?: number[];
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(0, idx)]!;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function triple(values: number[]): Triple {
  return {
    median: round2(median(values)),
    p95: round2(percentile(values, 0.95)),
    p99: round2(percentile(values, 0.99)),
    samples: values.length,
  };
}

/**
 * Cost of 1,000 actions when they run back to back at `actionsPerSecond`
 * inside one session, billed with the provider's granularity. One long
 * session rather than many short ones, or per-minute minimums would dominate.
 */
export function costPer1kActions(
  actionsPerSecond: number | null,
  pricing: { ratePerHour: number; billing: "per_minute" | "per_second"; minimumSeconds: number; perSessionCreationFee: number } | null
): number | null {
  if (!pricing || !actionsPerSecond || actionsPerSecond <= 0) return null;
  const seconds = 1000 / actionsPerSecond;
  const billedSeconds =
    pricing.billing === "per_minute"
      ? Math.max(pricing.minimumSeconds, Math.ceil(seconds / 60) * 60)
      : Math.max(pricing.minimumSeconds, seconds);
  const usage = (billedSeconds / 3600) * pricing.ratePerHour;
  return Math.round((pricing.perSessionCreationFee + usage) * 1e6) / 1e6;
}

export interface ProviderMeta {
  displayName: string;
  url: string;
  browserRegion?: string;
}

/**
 * Builds one leaderboard row from a provider's measured sessions. Warm-ups
 * must already be filtered out. Timing stats use sessions that ran end to end
 * (every action attempted), the way hello-browser uses successful runs; the
 * strict success rate is reported alongside.
 */
export function summarizeBrowserThroughput(
  provider: string,
  entries: BrowserThroughputEntry[],
  meta: ProviderMeta,
  pricing: Parameters<typeof costPer1kActions>[1],
  pricePerHour: number | null
): BrowserThroughputProviderStats | null {
  if (entries.length === 0) return null;

  const strict = entries.filter((e) => e.success);
  // Sessions whose infrastructure held up: the action list is complete, even
  // if some actions inside it failed.
  const measured = entries.filter((e) => e.actions.length > 0 && e.task_ms != null);

  const actionsTotal = entries.reduce((s, e) => s + e.actions_total, 0);
  const actionsCompleted = entries.reduce((s, e) => s + e.actions_completed, 0);

  const perAction = {} as Record<AgentActionType, Triple>;
  for (const type of AGENT_ACTION_TYPES) {
    const durations = measured.flatMap((e) =>
      e.actions.filter((a) => a.type === type && a.success && !a.skipped).map((a) => a.duration_ms)
    );
    perAction[type] = triple(durations);
  }

  // Drift compares two complete loops. A loop with a failed or skipped action
  // is shorter for the wrong reason, so it would make the session look faster.
  const loopComplete = (e: BrowserThroughputEntry, loop: number) => {
    const inLoop = e.actions.filter((a) => a.loop === loop);
    return inLoop.length > 0 && inLoop.every((a) => a.success && !a.skipped);
  };
  const drifts = measured
    .filter((e) => e.loops > 1 && e.first_loop_ms && e.last_loop_ms)
    .filter((e) => loopComplete(e, 1) && loopComplete(e, e.loops))
    .map((e) => e.last_loop_ms! / e.first_loop_ms!);

  const aps = triple(measured.map((e) => e.actions_per_second ?? 0));

  return {
    provider,
    displayName: meta.displayName,
    url: meta.url,
    ...(meta.browserRegion ? { browserRegion: meta.browserRegion } : {}),
    ...(entries[0]?._runDate ? { runDate: entries[0]._runDate } : {}),
    totalRuns: entries.length,
    concurrency: entries[0]?.concurrency ?? 1,
    loops: entries[0]?.loops ?? 1,
    actionsPerSession: entries[0]?.actions_total ?? 0,
    successRate: (strict.length / entries.length) * 100,
    actionCompletionRate: actionsTotal > 0 ? (actionsCompleted / actionsTotal) * 100 : 0,
    actionsPerSecond: aps,
    taskMs: triple(measured.map((e) => e.task_ms ?? 0)),
    createMs: triple(measured.map((e) => e.session_creation_ms ?? 0)),
    perAction,
    driftRatio: drifts.length > 0 ? Math.round(median(drifts) * 100) / 100 : null,
    costPer1kActionsUsd: costPer1kActions(aps.median, pricing),
    pricePerHour,
    rank: 0,
  };
}

/** Higher throughput first; providers with no measured session go last. */
export function rankBrowserThroughput(stats: BrowserThroughputProviderStats[]): BrowserThroughputProviderStats[] {
  const ranked = [...stats].sort((a, b) => {
    const am = a.actionsPerSecond.median;
    const bm = b.actionsPerSecond.median;
    if (bm !== am) return bm - am;
    return b.successRate - a.successRate;
  });
  let rank = 0;
  for (let i = 0; i < ranked.length; i++) {
    const s = ranked[i]!;
    if (s.actionsPerSecond.median <= 0) {
      s.rank = 0;
      continue;
    }
    if (i === 0 || ranked[i - 1]!.actionsPerSecond.median !== s.actionsPerSecond.median) rank = i + 1;
    s.rank = rank;
  }
  return ranked;
}
