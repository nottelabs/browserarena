/**
 * Latency-regression detector.
 *
 * Why this exists: on 2026-09-05 Notte's `session_release_ms` median jumped
 * 25ms -> 1071ms and stayed there for five days before anyone noticed. Nothing
 * in this repo watched for regressions, success-rate drops, or a dead cron.
 *
 * The hard requirement is telling a *sustained step change* (2026-09-05, alert)
 * apart from a *one-day spike* (2026-08-29: creation 132->960, goto 85->622,
 * normal again the next day — do NOT alert). A day-over-day comparison fires on
 * the spike, trains everyone to ignore the channel, and still misses the real
 * regression. Hence the K-of-N persistence rule below.
 *
 * Read `docs/regression-detection.md` before touching the thresholds.
 */

import {
  loadHistoricalLeaderboard,
  median,
  type HistoricalLeaderboardResult,
  type HistoricalProviderPoint,
} from "./data";

export type HealthStatus = "ok" | "degraded" | "stale" | "unknown";

export type MetricKey =
  | "creation"
  | "connect"
  | "goto"
  | "release"
  | "total"
  | "successRate";

export interface RegressionConfig {
  /** Size of the recent window, in run-days. */
  recentDays: number;
  /** How many of `recentDays` must breach before we call it a regression. */
  minBreachDays: number;
  /** Size of the baseline window, in run-days. */
  baselineDays: number;
  /** Baseline must clear at least this many days or we report `unknown`. */
  minBaselineDays: number;
  /** A day breaches only if current/baseline >= this... */
  minRatio: number;
  /** ...AND current-baseline >= this. Both, always. */
  minAbsMs: number;
  /** Success-rate drop, in percentage points, that counts as a breach. */
  successRateDropPts: number;
  /** ...and the absolute ceiling below which a drop counts at all. */
  successRateFloor: number;
  /** Hours since the last recorded run before a provider is `stale`. */
  stalenessHours: number;
}

export const DEFAULT_CONFIG: RegressionConfig = {
  recentDays: 3,
  minBreachDays: 2,
  baselineDays: 28,
  minBaselineDays: 7,
  minRatio: 1.5,
  minAbsMs: 50,
  successRateDropPts: 5,
  successRateFloor: 95,
  stalenessHours: 36,
};

interface MetricSpec {
  key: MetricKey;
  unit: "ms" | "percent";
  /** "up" = higher is worse (latency). "down" = lower is worse (success rate). */
  direction: "up" | "down";
  label: string;
}

export const METRIC_SPECS: MetricSpec[] = [
  { key: "creation", unit: "ms", direction: "up", label: "session creation" },
  { key: "connect", unit: "ms", direction: "up", label: "CDP connect" },
  { key: "goto", unit: "ms", direction: "up", label: "page goto" },
  { key: "release", unit: "ms", direction: "up", label: "session release" },
  { key: "total", unit: "ms", direction: "up", label: "total" },
  { key: "successRate", unit: "percent", direction: "down", label: "success rate" },
];

const METRIC_BY_KEY = new Map(METRIC_SPECS.map((s) => [s.key, s]));

/** Latency phases only — `total` is derived from these, `successRate` is not a phase. */
const PHASE_KEYS: MetricKey[] = ["creation", "connect", "goto", "release"];

export function metricValue(
  point: HistoricalProviderPoint,
  metric: MetricKey
): number {
  switch (metric) {
    case "creation":
      return point.medianCreationMs;
    case "connect":
      return point.medianConnectMs;
    case "goto":
      return point.medianGotoMs;
    case "release":
      return point.medianReleaseMs;
    case "total":
      return point.totalTimeMs;
    case "successRate":
      return point.successRate;
  }
}

export interface MetricVerdict {
  metric: MetricKey;
  label: string;
  unit: "ms" | "percent";
  /** Median of daily medians across the baseline window. */
  baseline: number;
  /** Median of daily values across the recent window. */
  current: number;
  ratio: number;
  delta: number;
  breachDays: number;
  breached: boolean;
  /** Date the current run of consecutive breaching days began. */
  onsetDate: string | null;
  /** How many consecutive days back the breach extends. */
  breachAgeDays: number;
  recent: { date: string; value: number; breached: boolean }[];
  /** Last 14 daily values, oldest first. */
  sparkline: { date: string; value: number }[];
}

export interface SeriesHealth {
  provider: string;
  displayName: string;
  concurrency: number;
  status: HealthStatus;
  /** Set when status is `unknown`: why we could not judge. */
  reason: "no_data" | "insufficient_history" | null;
  lastRunDate: string | null;
  lastRunAt: string | null;
  ageHours: number | null;
  daysOfHistory: number;
  metrics: MetricVerdict[];
  /** The breached subset of `metrics`, worst first. */
  breaches: MetricVerdict[];
  summary: string;
}

export interface HealthReport {
  status: HealthStatus;
  summary: string;
  benchmark: "hello-browser";
  concurrency: number;
  evaluatedAt: string;
  config: RegressionConfig;
  /** Providers whose latest run is older than `stalenessHours`. */
  stale: string[];
  series: SeriesHealth[];
}

function resolveConfig(partial?: Partial<RegressionConfig>): RegressionConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

/**
 * Windows are POSITIONAL (run-days), not calendar days. Providers have gaps in
 * their history — calendar arithmetic would silently produce short or empty
 * windows on either side of a gap.
 *
 * The baseline stops one full recent-window short of `index`, so a persisting
 * regression can never contribute to the baseline it is measured against.
 */
function windowsAt(
  points: HistoricalProviderPoint[],
  index: number,
  config: RegressionConfig
) {
  const recentStart = index - config.recentDays + 1;
  const recent = points.slice(Math.max(0, recentStart), index + 1);
  const baselineEnd = Math.max(0, recentStart);
  const baseline = points.slice(
    Math.max(0, baselineEnd - config.baselineDays),
    baselineEnd
  );
  return { recent, baseline };
}

function isBreachingDay(
  value: number,
  baseline: number,
  spec: MetricSpec,
  config: RegressionConfig
): boolean {
  if (spec.direction === "up") {
    // Dual threshold. The ratio alone would fire on a 6ms -> 10ms wobble; the
    // absolute floor alone would fire on any slow-but-stable phase.
    if (baseline <= 0) return false;
    return value >= baseline * config.minRatio && value - baseline >= config.minAbsMs;
  }
  return (
    value <= baseline - config.successRateDropPts && value < config.successRateFloor
  );
}

/**
 * The set of metrics breaching as of `index`, or `null` when there is not
 * enough history to judge. This is the primitive the edge-triggered Slack
 * dedup diffs against `index - 1`.
 */
export function breachingMetricsAt(
  points: HistoricalProviderPoint[],
  index: number,
  partial?: Partial<RegressionConfig>
): Set<MetricKey> | null {
  const config = resolveConfig(partial);
  if (index < 0 || index >= points.length) return null;

  const { recent, baseline } = windowsAt(points, index, config);
  if (recent.length < config.recentDays) return null;
  if (baseline.length < config.minBaselineDays) return null;

  const breaching = new Set<MetricKey>();
  for (const spec of METRIC_SPECS) {
    const baselineValue = median(baseline.map((p) => metricValue(p, spec.key)));
    const breachDays = recent.filter((p) =>
      isBreachingDay(metricValue(p, spec.key), baselineValue, spec, config)
    ).length;
    if (breachDays >= config.minBreachDays) breaching.add(spec.key);
  }

  // `total` is the sum of the phases. When a phase already fired, reporting
  // `total` too turns one root cause into two alerts naming the same event.
  if (breaching.size > 1 && PHASE_KEYS.some((k) => breaching.has(k))) {
    breaching.delete("total");
  }
  return breaching;
}

function buildVerdict(
  points: HistoricalProviderPoint[],
  index: number,
  spec: MetricSpec,
  config: RegressionConfig,
  breached: boolean
): MetricVerdict {
  const { recent, baseline } = windowsAt(points, index, config);
  const baselineValue = median(baseline.map((p) => metricValue(p, spec.key)));
  const currentValue = median(recent.map((p) => metricValue(p, spec.key)));

  const recentDetail = recent.map((p) => ({
    date: p.date,
    value: metricValue(p, spec.key),
    breached: isBreachingDay(metricValue(p, spec.key), baselineValue, spec, config),
  }));

  // Walk backwards from `index` while days keep breaching, to find when this
  // episode started. Reported as the onset date in the alert.
  let breachAgeDays = 0;
  let onsetDate: string | null = null;
  for (let i = index; i >= 0; i--) {
    if (!isBreachingDay(metricValue(points[i], spec.key), baselineValue, spec, config)) {
      break;
    }
    breachAgeDays++;
    onsetDate = points[i].date;
  }

  const sparkline = points
    .slice(Math.max(0, index - 13), index + 1)
    .map((p) => ({ date: p.date, value: metricValue(p, spec.key) }));

  const ratio = baselineValue > 0 ? currentValue / baselineValue : 0;

  return {
    metric: spec.key,
    label: spec.label,
    unit: spec.unit,
    baseline: baselineValue,
    current: currentValue,
    ratio,
    delta: currentValue - baselineValue,
    breachDays: recentDetail.filter((r) => r.breached).length,
    breached,
    onsetDate,
    breachAgeDays,
    recent: recentDetail,
    sparkline,
  };
}

function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function describeVerdict(v: MetricVerdict): string {
  if (v.unit === "percent") {
    return `${v.label} ${v.baseline.toFixed(1)}% -> ${v.current.toFixed(1)}%`;
  }
  return `${v.label} ${formatMs(v.baseline)} -> ${formatMs(v.current)} (${v.ratio.toFixed(1)}x)`;
}

export function evaluateSeries(
  points: HistoricalProviderPoint[],
  meta: { provider: string; displayName: string; concurrency: number },
  now: Date,
  partial?: Partial<RegressionConfig>
): SeriesHealth {
  const config = resolveConfig(partial);
  const base = {
    provider: meta.provider,
    displayName: meta.displayName,
    concurrency: meta.concurrency,
    daysOfHistory: points.length,
  };

  if (points.length === 0) {
    return {
      ...base,
      status: "unknown",
      reason: "no_data",
      lastRunDate: null,
      lastRunAt: null,
      ageHours: null,
      metrics: [],
      breaches: [],
      summary: `${meta.displayName}: no data`,
    };
  }

  const index = points.length - 1;
  const latest = points[index];
  const lastRunAt = latest.lastEntryAt ?? `${latest.date}T00:00:00.000Z`;
  const ageHours = (now.getTime() - Date.parse(lastRunAt)) / 3_600_000;
  const stale = ageHours > config.stalenessHours;

  const breaching = breachingMetricsAt(points, index, config);

  if (breaching === null) {
    // Cold start: a new provider is `unknown` until it has enough history, and
    // `unknown` never pages.
    return {
      ...base,
      status: stale ? "stale" : "unknown",
      reason: "insufficient_history",
      lastRunDate: latest.date,
      lastRunAt,
      ageHours,
      metrics: [],
      breaches: [],
      summary: stale
        ? `${meta.displayName}: no results for ${Math.round(ageHours)}h`
        : `${meta.displayName}: only ${points.length} run-days of history, need ${
            config.minBaselineDays + config.recentDays
          }`,
    };
  }

  const metrics = METRIC_SPECS.map((spec) =>
    buildVerdict(points, index, spec, config, breaching.has(spec.key))
  );
  const breaches = metrics
    .filter((m) => m.breached)
    .sort((a, b) => b.ratio - a.ratio);

  // Staleness wins over degraded on purpose: if the cron died, the latency
  // numbers are stale too, and the actionable fact is the dead cron.
  const status: HealthStatus = stale
    ? "stale"
    : breaches.length > 0
      ? "degraded"
      : "ok";

  let summary: string;
  if (stale) {
    summary = `${meta.displayName}: no results for ${Math.round(ageHours)}h (last ${latest.date})`;
  } else if (breaches.length > 0) {
    const worst = breaches[0];
    const since = worst.onsetDate ? ` since ${worst.onsetDate}` : "";
    summary = `${meta.displayName} ${describeVerdict(worst)}${since}`;
    if (breaches.length > 1) summary += ` (+${breaches.length - 1} more)`;
  } else {
    summary = `${meta.displayName}: ok`;
  }

  return {
    ...base,
    status,
    reason: null,
    lastRunDate: latest.date,
    lastRunAt,
    ageHours,
    metrics,
    breaches,
    summary,
  };
}

const STATUS_RANK: Record<HealthStatus, number> = {
  ok: 0,
  unknown: 1,
  degraded: 2,
  stale: 3,
};

export function evaluateHistory(
  history: HistoricalLeaderboardResult,
  concurrency: number,
  now: Date,
  partial?: Partial<RegressionConfig>
): HealthReport {
  const config = resolveConfig(partial);
  const series = history.providers
    .map((p) =>
      evaluateSeries(
        p.points,
        { provider: p.provider, displayName: p.displayName, concurrency },
        now,
        config
      )
    )
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);

  const status = series.reduce<HealthStatus>(
    (worst, s) => (STATUS_RANK[s.status] > STATUS_RANK[worst] ? s.status : worst),
    "ok"
  );

  const stale = series.filter((s) => s.status === "stale").map((s) => s.provider);
  const degraded = series.filter((s) => s.status === "degraded");

  let summary: string;
  if (series.length === 0) {
    summary = "no providers";
  } else if (stale.length > 0) {
    summary = `stale: ${stale.join(", ")}`;
  } else if (degraded.length > 0) {
    summary = degraded.map((s) => s.summary).join("; ");
  } else {
    summary = `all ${series.length} providers within baseline`;
  }

  return {
    status,
    summary,
    benchmark: "hello-browser",
    concurrency,
    evaluatedAt: now.toISOString(),
    config,
    stale,
    series,
  };
}

/**
 * Loads history off disk (or the GitHub fallback) and evaluates it.
 *
 * `results/` is traced into the Vercel lambda bundle — verified via
 * `.next/server/app/api/**\/*.nft.json`, which lists ~3k `results/` files — so
 * this works at request time and the clock is the request's, not the build's.
 * That matters: a dead cron produces no commit, so no rebuild, so a build-time
 * clock could never notice its own data aging.
 */
export async function loadHealthReport(
  benchmark: "hello-browser",
  concurrency: number,
  now: Date,
  partial?: Partial<RegressionConfig>
): Promise<HealthReport> {
  const history = await loadHistoricalLeaderboard(benchmark, concurrency);
  return evaluateHistory(history, concurrency, now, partial);
}
