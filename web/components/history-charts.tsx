"use client";
import { track } from "@/lib/analytics";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  HistoricalLeaderboardResult,
  HistoricalProviderPoint,
  PercentileType,
} from "@/lib/data-shared";
import {
  HISTORY_RANGES,
  filterDatesToRange,
  isIsolatedPoint,
  type HistoryRangeKey,
} from "@/lib/history-range";
import { hasSuccessfulRuns } from "@/lib/ranking";
import { LifecycleDistribution } from "./benchmarks/lifecycle-distribution";
import { BenchmarkSectionHeader } from "./benchmarks/section-header";
import styles from "./benchmarks/benchmark.module.css";

const HISTORY_START_DATE = "2026-05-15";
// Above this many points, per-point dots turn the lines into noise.
const LINE_DOT_MAX_POINTS = 14;
const BREAKDOWN_AXIS_LEAD_MS = 360;

type PhaseMetricKeys = {
  create: keyof HistoricalProviderPoint;
  connect: keyof HistoricalProviderPoint;
  goto: keyof HistoricalProviderPoint;
  release: keyof HistoricalProviderPoint;
  total: keyof HistoricalProviderPoint;
};

const PHASE_KEYS: Record<PercentileType, PhaseMetricKeys> = {
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

const PHASE_CONFIG = {
  create: {
    label: "Create",
    color: "#4E79A7",
  },
  connect: {
    label: "Connect",
    color: "#F28E2B",
  },
  goto: {
    label: "Goto",
    color: "#E15759",
  },
  release: {
    label: "Release",
    color: "#76B7B2",
  },
} satisfies ChartConfig;

const PHASE_ORDER_TOP_DOWN = ["release", "goto", "connect", "create"];

type HistoryMetric = "score" | "total" | "create" | "connect" | "goto" | "release";

const HISTORY_METRICS: { key: HistoryMetric; label: string }[] = [
  { key: "score", label: "Value score" },
  { key: "total", label: "Total" },
  { key: "create", label: "Create" },
  { key: "connect", label: "Connect" },
  { key: "goto", label: "Goto" },
  { key: "release", label: "Release" },
];

const metricButtonClass = (active: boolean) =>
  `shrink-0 rounded-[3px] border px-3 py-1.5 text-[0.68rem] font-medium transition-colors ${
    active
      ? "border-foreground bg-foreground text-background"
      : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
  }`;

function historyMetricValue(
  metric: HistoryMetric,
  point: HistoricalProviderPoint,
  keys: PhaseMetricKeys,
  pricePerHour: number | null,
): number | null {
  if (!hasSuccessfulRuns(point)) return null;
  if (metric === "score") {
    return computeValueScore({
      latencyMs: point[keys.total] as number,
      successRate: point.successRate,
      pricePerHour,
    });
  }
  const key = metric === "total" ? keys.total
    : metric === "create" ? keys.create
    : metric === "connect" ? keys.connect
    : metric === "goto" ? keys.goto
    : keys.release;
  const value = point[key];
  return typeof value === "number" ? value : null;
}

const PROVIDER_COLORS = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
];

const VALUE_ANCHORS = {
  latency: { floor: 10_000, ceiling: 0 },
  reliability: { floor: 90, ceiling: 100 },
  cost: { floor: 0.20, ceiling: 0 },
};

function formatDateLabel(ymd: string): string {
  const [, month, day] = ymd.split("-");
  return month && day ? `${month}/${day}` : ymd;
}

function formatMs(value: unknown): string {
  return typeof value === "number"
    ? `${Math.round(value).toLocaleString("en-US")} ms`
    : "";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function computeValueScore({
  latencyMs,
  successRate,
  pricePerHour,
}: {
  latencyMs: number;
  successRate: number;
  pricePerHour: number | null;
}): number {
  const latencyRange = VALUE_ANCHORS.latency.floor - VALUE_ANCHORS.latency.ceiling;
  const reliabilityRange = VALUE_ANCHORS.reliability.ceiling - VALUE_ANCHORS.reliability.floor;
  const costRange = VALUE_ANCHORS.cost.floor - VALUE_ANCHORS.cost.ceiling;

  const normalizedLatency = clamp01(
    (VALUE_ANCHORS.latency.floor - latencyMs) / latencyRange
  );
  const normalizedReliability = clamp01(
    (successRate - VALUE_ANCHORS.reliability.floor) / reliabilityRange
  );
  const normalizedCost =
    pricePerHour != null
      ? clamp01((VALUE_ANCHORS.cost.floor - pricePerHour) / costRange)
      : 0;

  return (normalizedLatency + normalizedReliability + normalizedCost) / 3;
}

function formatScore(value: unknown): string {
  return typeof value === "number" ? value.toFixed(3) : "";
}

function computeBreakdownDomain(
  series: { points: HistoricalProviderPoint[] } | undefined,
  keys: PhaseMetricKeys
): [number, number] {
  if (!series) return [0, 1000];
  const max = Math.max(
    ...series.points.map((point) =>
      (point[keys.create] as number) +
      (point[keys.connect] as number) +
      (point[keys.goto] as number) +
      (point[keys.release] as number)
    )
  );
  if (!Number.isFinite(max) || max <= 0) return [0, 1000];
  return [0, Math.ceil((max * 1.08) / 100) * 100];
}

type ValueScoreTooltipItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: unknown;
  color?: string;
  payload?: { date?: string };
};

type BreakdownTooltipItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: unknown;
  color?: string;
  payload?: { date?: string };
};

function ValueScoreTooltip({
  active,
  payload,
  config,
  formatValue = formatScore,
}: {
  active?: boolean;
  payload?: ValueScoreTooltipItem[];
  config: ChartConfig;
  formatValue?: (value: unknown) => string;
}) {
  if (!active || !payload?.length) return null;

  const rows = payload
    .filter((item): item is ValueScoreTooltipItem & { value: number } =>
      typeof item.value === "number"
    )
    .sort((a, b) => b.value - a.value);
  if (rows.length === 0) return null;

  return (
    <div className="grid min-w-[10rem] items-start gap-1.5 rounded-none border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{rows[0]?.payload?.date}</div>
      <div className="grid gap-1.5">
        {rows.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          return (
            <div key={key} className="flex w-full items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="min-w-0 flex-1 text-muted-foreground">
                {config[key]?.label ?? key}
              </span>
              <span className="font-mono font-medium text-foreground tabular-nums">
                {formatValue(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BreakdownTooltip({
  active,
  payload,
  config,
}: {
  active?: boolean;
  payload?: BreakdownTooltipItem[];
  config: ChartConfig;
}) {
  if (!active || !payload?.length) return null;

  const phaseRank = new Map(
    PHASE_ORDER_TOP_DOWN.map((key, index) => [key, index])
  );
  const rows = payload
    .filter((item): item is BreakdownTooltipItem & { value: number } =>
      typeof item.value === "number"
    )
    .sort((a, b) => {
      const aKey = String(a.dataKey ?? a.name ?? "");
      const bKey = String(b.dataKey ?? b.name ?? "");
      return (phaseRank.get(aKey) ?? 99) - (phaseRank.get(bKey) ?? 99);
    });
  if (rows.length === 0) return null;

  return (
    <div className="grid min-w-[10rem] items-start gap-1.5 rounded-none border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{rows[0]?.payload?.date}</div>
      <div className="grid gap-1.5">
        {rows.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          return (
            <div key={key} className="flex w-full items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor:
                    item.color ||
                    ("color" in (config[key] ?? {}) ? config[key]?.color : undefined),
                }}
              />
              <span className="min-w-0 flex-1 text-muted-foreground">
                {config[key]?.label ?? key}
              </span>
              <span className="font-mono font-medium text-foreground tabular-nums">
                {formatMs(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HistoryCharts({
  history,
  percentile = "median",
  initialProvider,
  selectedDate,
  animate = true,
  distributions = [],
}: {
  history: HistoricalLeaderboardResult;
  percentile?: PercentileType;
  initialProvider?: string;
  selectedDate?: string;
  animate?: boolean;
  distributions?: { provider: string; displayName: string; sessionMs: number[] }[];
}) {
  const [range, setRange] = useState<HistoryRangeKey>("1w");
  const [metric, setMetric] = useState<HistoryMetric>("score");
  const activeRange =
    HISTORY_RANGES.find((option) => option.key === range) ?? HISTORY_RANGES[0];
  const visibleDates = useMemo(
    () => filterDatesToRange(history.dates, activeRange.days, HISTORY_START_DATE),
    [activeRange.days, history.dates]
  );
  const visibleDateSet = useMemo(() => new Set(visibleDates), [visibleDates]);
  const showLineDots = visibleDates.length <= LINE_DOT_MAX_POINTS;
  const keys = PHASE_KEYS[percentile];

  const providerOptions = useMemo(
    () =>
      history.providers
        .map((provider) => ({
          ...provider,
          points: provider.points.filter((point) => visibleDateSet.has(point.date)),
        }))
        .filter((provider) => provider.points.length > 0)
        .sort((a, b) => {
          // Notte leads the selector; the rest stay ordered by value score.
          if (a.provider !== b.provider) {
            if (a.provider === "NOTTE") return -1;
            if (b.provider === "NOTTE") return 1;
          }
          const latestA = [...a.points].sort((x, y) => y.date.localeCompare(x.date))[0];
          const latestB = [...b.points].sort((x, y) => y.date.localeCompare(x.date))[0];
          const scoreA = latestA && hasSuccessfulRuns(latestA)
            ? computeValueScore({
                latencyMs: latestA[keys.total] as number,
                successRate: latestA.successRate,
                pricePerHour: a.pricePerHour,
              })
            : -Infinity;
          const scoreB = latestB && hasSuccessfulRuns(latestB)
            ? computeValueScore({
                latencyMs: latestB[keys.total] as number,
                successRate: latestB.successRate,
                pricePerHour: b.pricePerHour,
              })
            : -Infinity;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.displayName.localeCompare(b.displayName);
        }),
    [history.providers, keys.total, visibleDateSet]
  );
  const [selectedProvider, setSelectedProvider] = useState(
    initialProvider && providerOptions.some((p) => p.provider === initialProvider)
      ? initialProvider
      : providerOptions[0]?.provider
  );
  const [displayedBreakdownProvider, setDisplayedBreakdownProvider] = useState(
    selectedProvider
  );
  const [animatedBreakdownDomain, setAnimatedBreakdownDomain] =
    useState<[number, number] | null>(null);
  const animatedBreakdownDomainRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (providerOptions.length === 0) return;
    if (selectedProvider && providerOptions.some((p) => p.provider === selectedProvider)) {
      return;
    }
    setSelectedProvider(providerOptions[0]?.provider);
  }, [providerOptions, selectedProvider]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (!displayedBreakdownProvider) {
      setDisplayedBreakdownProvider(selectedProvider);
      return;
    }
  }, [displayedBreakdownProvider, selectedProvider]);

  const selectedSeries = providerOptions.find(
    (p) => p.provider === selectedProvider
  ) ?? providerOptions[0];
  const displayedBreakdownSeries = providerOptions.find(
    (p) => p.provider === displayedBreakdownProvider
  ) ?? selectedSeries;

  const providerConfig = useMemo(() => {
    const config: ChartConfig = {};
    providerOptions.forEach((provider, index) => {
      config[provider.provider] = {
        label: provider.displayName,
        color: PROVIDER_COLORS[index % PROVIDER_COLORS.length],
      };
    });
    return config;
  }, [providerOptions]);

  const stackedData = useMemo(() => {
    if (!displayedBreakdownSeries) return [];
    return displayedBreakdownSeries.points.map((point) => {
      // Keep the date on the axis, but draw no bar when nothing was measured.
      const measured = hasSuccessfulRuns(point);
      return {
        date: point.date,
        label: formatDateLabel(point.date),
        create: measured ? point[keys.create] : null,
        connect: measured ? point[keys.connect] : null,
        goto: measured ? point[keys.goto] : null,
        release: measured ? point[keys.release] : null,
      };
    });
  }, [displayedBreakdownSeries, keys]);

  const displayedBreakdownDomain = useMemo(
    () => computeBreakdownDomain(displayedBreakdownSeries, keys),
    [displayedBreakdownSeries, keys]
  );

  const targetBreakdownDomain = useMemo(
    () => computeBreakdownDomain(selectedSeries, keys),
    [keys, selectedSeries]
  );

  useEffect(() => {
    const fromDomain = animatedBreakdownDomainRef.current ?? displayedBreakdownDomain;
    const toDomain = targetBreakdownDomain;
    const isScaleDown = toDomain[1] < fromDomain[1];

    if (
      selectedProvider === displayedBreakdownProvider &&
      fromDomain[0] === toDomain[0] &&
      fromDomain[1] === toDomain[1]
    ) {
      animatedBreakdownDomainRef.current = toDomain;
      setAnimatedBreakdownDomain(toDomain);
      return;
    }

    if (isScaleDown && selectedProvider !== displayedBreakdownProvider) {
      setDisplayedBreakdownProvider(selectedProvider);
    }

    let frame = 0;
    let timeout = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / BREAKDOWN_AXIS_LEAD_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextDomain: [number, number] = [
        fromDomain[0] + (toDomain[0] - fromDomain[0]) * eased,
        fromDomain[1] + (toDomain[1] - fromDomain[1]) * eased,
      ];
      animatedBreakdownDomainRef.current = nextDomain;
      setAnimatedBreakdownDomain(nextDomain);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        animatedBreakdownDomainRef.current = toDomain;
        setAnimatedBreakdownDomain(toDomain);
        if (!isScaleDown) {
          timeout = window.setTimeout(() => {
            setDisplayedBreakdownProvider(selectedProvider);
          }, 40);
        }
      }
    };

    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [
    displayedBreakdownDomain,
    displayedBreakdownProvider,
    selectedProvider,
    targetBreakdownDomain,
  ]);

  const breakdownDomain = useMemo<[number, number]>(() => {
    return animatedBreakdownDomain ?? displayedBreakdownDomain;
  }, [animatedBreakdownDomain, displayedBreakdownDomain]);

  const lineData = useMemo(() => {
    return visibleDates.map((date) => {
      const row: Record<string, string | number | null> = {
        date,
        label: formatDateLabel(date),
      };
      for (const provider of providerOptions) {
        // A day with no successful runs has no latency to score: leave a gap.
        const point = provider.points.find((item) => item.date === date);
        row[provider.provider] = point ? historyMetricValue(metric, point, keys, provider.pricePerHour) : null;
      }
      return row;
    });
  }, [keys, metric, providerOptions, visibleDates]);

  const scoresByProvider = useMemo(() => {
    const scores: Record<string, Array<number | null>> = {};
    for (const provider of providerOptions) {
      scores[provider.provider] = lineData.map(
        (row) => row[provider.provider] as number | null
      );
    }
    return scores;
  }, [lineData, providerOptions]);

  const scoreDomain = useMemo<[number, number]>(() => {
    const values = lineData.flatMap((row) =>
      providerOptions
        .map((provider) => row[provider.provider])
        .filter((value): value is number => typeof value === "number")
    );
    if (values.length === 0) return [0, 1];
    const max = Math.max(...values);
    if (metric !== "score") {
      if (max <= 0) return [0, 1000];
      return [0, Math.ceil((max * 1.08) / 100) * 100];
    }

    const min = Math.min(...values);
    if (min === max) {
      const pad = 0.02;
      return [Math.max(0, min - pad), Math.min(1, max + pad)];
    }

    const pad = (max - min) * 0.08;
    return [Math.max(0, min - pad), Math.min(1, max + pad)];
  }, [lineData, metric, providerOptions]);

  const snapshotDate = selectedDate && history.providers.some((provider) => provider.points.some((point) => point.date === selectedDate && hasSuccessfulRuns(point)))
    ? selectedDate
    : [...visibleDates].reverse().find((date) => providerOptions.some((provider) => {
        const point = provider.points.find((item) => item.date === date);
        return point ? hasSuccessfulRuns(point) : false;
      }));
  const snapshotRows = history.providers.flatMap((provider) => {
    const point = provider.points.find((item) => item.date === snapshotDate);
    const value = point ? historyMetricValue(metric, point, keys, provider.pricePerHour) : null;
    return value == null ? [] : [{ provider: provider.provider, name: provider.displayName, value }];
  }).sort((a, b) => metric === "score" ? b.value - a.value : a.value - b.value);
  const metricLabel = HISTORY_METRICS.find((item) => item.key === metric)?.label ?? "Value score";
  const percentileLabel = percentile === "median" ? "Median" : percentile.toUpperCase();

  if (providerOptions.length === 0) return null;

  return (
    <section id="history" className="reveal-up reveal-up-delay-1 mb-8 sm:mb-12 scroll-mt-20">
      <div className={styles.charts}>
        <section className="flex min-w-0 flex-col">
          <BenchmarkSectionHeader chart title="History" description={`Showing ${visibleDates.length} run ${visibleDates.length === 1 ? "date" : "dates"} from the ${activeRange.label.toLowerCase()}.`} controls={<div className="flex flex-wrap gap-1.5" aria-label="History range">
            {HISTORY_RANGES.map((option) => {
              const active = option.key === range;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setRange(option.key); track("history_range_selected", { benchmark: "session-performance", range: option.key }); }}
                  className={`shrink-0 rounded-[3px] border px-3 py-1.5 text-[0.68rem] font-medium transition-colors ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}

          </div>} />
        <div data-benchmark-panel="history" className="flex flex-1 flex-col rounded-[3px] border-[1.5px] border-foreground bg-background p-3 sm:p-4">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{metric === "score" ? "Provider Value Score" : metricLabel}</h3>
            <p className="text-muted-foreground">{metric === "score" ? "Composite score by run date. Higher is better." : `${percentileLabel} latency by run date. Lower is better.`}</p>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="History metric">
              {HISTORY_METRICS.map((item) => <button key={item.key} type="button" aria-pressed={item.key === metric} onClick={() => { setMetric(item.key); track("history_metric_selected", { benchmark: "session-performance", metric: item.key }); }} className={metricButtonClass(item.key === metric)}>{item.label}</button>)}
            </div>
          </div>
          <ChartContainer
            config={providerConfig}
            className="aspect-auto! h-[260px] w-full"
          >
            <LineChart data={lineData} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 2" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={48}
                domain={scoreDomain}
                tickFormatter={(value) => metric === "score" ? Number(value).toFixed(2) : `${(Number(value) / 1000).toFixed(1)}s`}
              />
              <ChartTooltip
                trigger="hover"
                content={<ValueScoreTooltip config={providerConfig} formatValue={metric === "score" ? formatScore : formatMs} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {providerOptions.map((provider) => (
                <Line
                  key={provider.provider}
                  type="monotone"
                  dataKey={provider.provider}
                  stroke={`var(--color-${provider.provider})`}
                  strokeWidth={2}
                  dot={
                    showLineDots
                      ? { r: 2 }
                      : ({ key, cx, cy, index }) =>
                          // Keep markers for points with no neighbours, which
                          // would otherwise draw nothing at all.
                          typeof cx === "number" &&
                          typeof cy === "number" &&
                          isIsolatedPoint(
                            scoresByProvider[provider.provider] ?? [],
                            index
                          ) ? (
                            <circle
                              key={key}
                              cx={cx}
                              cy={cy}
                              r={2}
                              fill="var(--background)"
                              stroke={`var(--color-${provider.provider})`}
                              strokeWidth={2}
                            />
                          ) : (
                            <g key={key} />
                          )
                  }
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={animate}
                  animationDuration={700}
                  animationEasing="ease-out"
                />
              ))}
            </LineChart>
          </ChartContainer>
        </div>

        </section>
        <section className="flex min-w-0 flex-col">
          <BenchmarkSectionHeader chart title="Results" description="Stacked daily phase latency. Lower is better." controls={
            <label className="flex items-center gap-2 text-xs text-muted-foreground">Provider
              <select aria-label="Breakdown provider" value={selectedProvider ?? ""} onChange={e => { setSelectedProvider(e.target.value); track("history_provider_selected", { benchmark: "session-performance", provider: e.target.value }); }} className="border border-foreground/25 bg-background text-foreground">
                {providerOptions.map(provider => <option key={provider.provider} value={provider.provider}>{provider.displayName}</option>)}
              </select>
            </label>
          } />
        <div data-benchmark-panel="breakdown" className="flex flex-1 flex-col rounded-[3px] border-[1.5px] border-foreground bg-background p-3 sm:p-4">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{selectedSeries?.displayName ?? "Provider"} Breakdown</h3>
            <p className="text-muted-foreground">Stacked daily phase latency. Lower is better.</p>
          </div>
          <ChartContainer
            config={PHASE_CONFIG}
            className="aspect-auto! h-[260px] w-full"
          >
            <BarChart data={stackedData} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 2" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={48}
                domain={breakdownDomain}
                tickFormatter={(value) => `${(Number(value) / 1000).toFixed(1)}s`}
              />
              <ChartTooltip
                content={<BreakdownTooltip config={PHASE_CONFIG} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {(["create", "connect", "goto", "release"] as const).map((key, index, arr) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="latency"
                  fill={`var(--color-${key})`}
                  radius={index === arr.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                  isAnimationActive={animate}
                  animationDuration={650}
                  animationBegin={index * 70}
                  animationEasing="ease-out"
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
        </section>
        {distributions.length > 0 && <section data-chart-span="row" className="flex min-w-0 flex-col">
          <BenchmarkSectionHeader chart title="Distribution" description={`${formatDateLabel(selectedDate || snapshotDate || "")} · Successful session totals. A fast median can still have a long tail.`} />
          <div className="flex flex-1 flex-col rounded-[3px] border-[1.5px] border-foreground bg-background p-3 sm:p-4">
            <LifecycleDistribution providers={distributions} dateLabel={formatDateLabel(selectedDate || snapshotDate || "")} />
          </div>
        </section>}
        <section data-chart-span="row" className="flex min-w-0 flex-col">
          <BenchmarkSectionHeader chart title="Comparison" description={snapshotDate ? `${formatDateLabel(snapshotDate)} · ${metric === "score" ? "Higher is better." : `${percentileLabel} latency. Lower is better.`}` : "No run day in this range."} />
          <div data-benchmark-panel="ranking" className="flex flex-1 flex-col rounded-[3px] border-[1.5px] border-foreground bg-background p-3 sm:p-4">
            <div data-panel-header>
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{metricLabel}</h3>
              <p className="text-muted-foreground">Every provider on the selected run day.</p>
            </div>
            {snapshotRows.length > 0 ? <ChartContainer config={providerConfig} className="aspect-auto! w-full">
              <BarChart layout="vertical" data={snapshotRows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid horizontal={false} strokeDasharray="2 2" />
                <XAxis type="number" domain={scoreDomain} tickLine={false} axisLine={false} tickFormatter={(value) => metric === "score" ? Number(value).toFixed(2) : `${(Number(value) / 1000).toFixed(1)}s`} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} />
                <ChartTooltip
                  content={({ active, payload }) => {
                    const row = payload?.[0];
                    if (!active || !row || typeof row.value !== "number") return null;
                    return <div className="grid min-w-[8rem] gap-1 rounded-none border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                      <div className="font-medium">{String(row.payload?.name ?? "")}</div>
                      <div className="font-mono font-medium tabular-nums">{metric === "score" ? formatScore(row.value) : formatMs(row.value)}</div>
                    </div>;
                  }}
                />
                <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={animate}>
                  {snapshotRows.map((row) => <Cell key={row.provider} fill={providerConfig[row.provider]?.color ?? "#4E79A7"} />)}
                </Bar>
              </BarChart>
            </ChartContainer> : <p className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">No successful runs on this day.</p>}
          </div>
        </section>
      </div>
    </section>
  );
}
