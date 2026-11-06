import type {
  HistoricalLeaderboardResult,
  HistoricalProviderPoint,
  HistoricalProviderSeries,
  PercentileType,
} from "./data-shared";
import { HISTORY_RANGES, filterDatesToRange } from "./history-range";

export const HISTORY_START_DATE = "2026-05-15";

export type PhaseMetricKeys = {
  create: keyof HistoricalProviderPoint;
  connect: keyof HistoricalProviderPoint;
  goto: keyof HistoricalProviderPoint;
  release: keyof HistoricalProviderPoint;
  total: keyof HistoricalProviderPoint;
};

export const PHASE_KEYS: Record<PercentileType, PhaseMetricKeys> = {
  median: {
    create: "medianCreationMs",
    connect: "medianConnectMs",
    goto: "medianGotoMs",
    release: "medianReleaseMs",
    total: "totalTimeMs",
  },
  p90: {
    create: "p90CreationMs",
    connect: "p90ConnectMs",
    goto: "p90GotoMs",
    release: "p90ReleaseMs",
    total: "p90TotalMs",
  },
  p95: {
    create: "p95CreationMs",
    connect: "p95ConnectMs",
    goto: "p95GotoMs",
    release: "p95ReleaseMs",
    total: "p95TotalMs",
  },
  p99: {
    create: "p99CreationMs",
    connect: "p99ConnectMs",
    goto: "p99GotoMs",
    release: "p99ReleaseMs",
    total: "p99TotalMs",
  },
};

/** A history point that may carry only the metrics of one percentile. */
export type HistoryChartPoint = Pick<HistoricalProviderPoint, "date" | "successRate"> &
  Partial<HistoricalProviderPoint>;

export interface HistoryChartData {
  dates: string[];
  providers: (Omit<HistoricalProviderSeries, "points"> & { points: HistoryChartPoint[] })[];
}

/**
 * The part of the lifecycle history the charts draw: the longest range, the
 * selected day, and the selected percentile. The full history is every
 * percentile of every run day, which made the page payload megabytes.
 */
export function historyChartData(
  history: HistoricalLeaderboardResult,
  percentile: PercentileType,
  selectedDate?: string
): HistoryChartData {
  const longestRange = Math.max(...HISTORY_RANGES.map((range) => range.days));
  const kept = new Set(filterDatesToRange(history.dates, longestRange, HISTORY_START_DATE));
  if (selectedDate) kept.add(selectedDate);
  const keys = Object.values(PHASE_KEYS[percentile]);
  return {
    dates: history.dates.filter((date) => kept.has(date)),
    providers: history.providers.map(({ points, ...provider }) => ({
      ...provider,
      points: points.filter((point) => kept.has(point.date)).map((point) => {
        const slim: HistoryChartPoint = { date: point.date, successRate: point.successRate };
        for (const key of keys) Object.assign(slim, { [key]: point[key] });
        return slim;
      }),
    })),
  };
}
