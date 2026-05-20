"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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

const HISTORY_START_DATE = "2026-05-15";
const HISTORY_DATE_CAP = 7;
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
}: {
  active?: boolean;
  payload?: ValueScoreTooltipItem[];
  config: ChartConfig;
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
                {formatScore(item.value)}
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
}: {
  history: HistoricalLeaderboardResult;
  percentile?: PercentileType;
  initialProvider?: string;
}) {
  const visibleDates = useMemo(
    () =>
      history.dates
        .filter((date) => date >= HISTORY_START_DATE)
        .slice(-HISTORY_DATE_CAP),
    [history.dates]
  );
  const keys = PHASE_KEYS[percentile];

  const providerOptions = useMemo(
    () =>
      history.providers
        .map((provider) => ({
          ...provider,
          points: provider.points.filter((point) => visibleDates.includes(point.date)),
        }))
        .filter((provider) => provider.points.length > 0)
        .sort((a, b) => {
          const latestA = [...a.points].sort((x, y) => y.date.localeCompare(x.date))[0];
          const latestB = [...b.points].sort((x, y) => y.date.localeCompare(x.date))[0];
          const scoreA = latestA
            ? computeValueScore({
                latencyMs: latestA[keys.total] as number,
                successRate: latestA.successRate,
                pricePerHour: a.pricePerHour,
              })
            : -Infinity;
          const scoreB = latestB
            ? computeValueScore({
                latencyMs: latestB[keys.total] as number,
                successRate: latestB.successRate,
                pricePerHour: b.pricePerHour,
              })
            : -Infinity;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.displayName.localeCompare(b.displayName);
        }),
    [history.providers, keys.total, visibleDates]
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
    return displayedBreakdownSeries.points.map((point) => ({
      date: point.date,
      label: formatDateLabel(point.date),
      create: point[keys.create],
      connect: point[keys.connect],
      goto: point[keys.goto],
      release: point[keys.release],
    }));
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
        const point = provider.points.find((p) => p.date === date);
        row[provider.provider] = point
          ? computeValueScore({
              latencyMs: point[keys.total] as number,
              successRate: point.successRate,
              pricePerHour: provider.pricePerHour,
            })
          : null;
      }
      return row;
    });
  }, [keys.total, providerOptions, visibleDates]);

  const scoreDomain = useMemo<[number, number]>(() => {
    const values = lineData.flatMap((row) =>
      providerOptions
        .map((provider) => row[provider.provider])
        .filter((value): value is number => typeof value === "number")
    );
    if (values.length === 0) return [0, 1];

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const pad = 0.02;
      return [Math.max(0, min - pad), Math.min(1, max + pad)];
    }

    const pad = (max - min) * 0.08;
    return [Math.max(0, min - pad), Math.min(1, max + pad)];
  }, [lineData, providerOptions]);

  if (providerOptions.length === 0) return null;

  return (
    <section id="history" className="reveal-up reveal-up-delay-1 mb-8 sm:mb-12 scroll-mt-20">
      <div className="mb-3 sm:mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
            History
          </h2>
          <p className="mt-1 text-[0.72rem] sm:text-[0.78rem] text-muted-foreground">
            Showing the latest {HISTORY_DATE_CAP} available run dates since May 15, 2026.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 sm:justify-end">
          {providerOptions.map((provider) => {
            const active = provider.provider === selectedProvider;
            return (
              <button
                key={provider.provider}
                type="button"
                onClick={() => setSelectedProvider(provider.provider)}
                className={`shrink-0 rounded-[3px] border px-3 py-1.5 text-[0.68rem] font-medium transition-colors ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                }`}
              >
                {provider.displayName}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div className="border-[1.5px] border-foreground rounded-[3px] bg-background p-3 sm:p-4">
          <div className="mb-3">
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">
              Provider Value Score
            </h3>
            <p className="mt-1 text-[0.68rem] text-muted-foreground">
              Composite score by run date. Higher is better.
            </p>
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
                tickFormatter={(value) => Number(value).toFixed(2)}
              />
              <ChartTooltip
                trigger="hover"
                content={<ValueScoreTooltip config={providerConfig} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {providerOptions.map((provider) => (
                <Line
                  key={provider.provider}
                  type="monotone"
                  dataKey={provider.provider}
                  stroke={`var(--color-${provider.provider})`}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive
                  animationDuration={700}
                  animationEasing="ease-out"
                />
              ))}
            </LineChart>
          </ChartContainer>
        </div>

        <div className="border-[1.5px] border-foreground rounded-[3px] bg-background p-3 sm:p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">
                {selectedSeries?.displayName ?? "Provider"} Breakdown
              </h3>
              <p className="mt-1 text-[0.68rem] text-muted-foreground">
                Stacked daily phase latency. Lower is better.
              </p>
            </div>
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
                  isAnimationActive
                  animationDuration={650}
                  animationBegin={index * 70}
                  animationEasing="ease-out"
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </section>
  );
}
