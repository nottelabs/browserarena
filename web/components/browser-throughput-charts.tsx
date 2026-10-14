"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import styles from "@/components/benchmarks/benchmark.module.css";
import { track } from "@/lib/analytics";
import { filterDatesToRange, HISTORY_RANGES, isIsolatedPoint, type HistoryRangeKey } from "@/lib/history-range";
import {
  AGENT_ACTION_LABELS,
  AGENT_ACTION_TYPES,
  type BrowserThroughputProviderStats,
  type ThroughputHistory,
  type ThroughputHistoryPoint,
  type Triple,
} from "@/lib/browser-throughput-shared";

type View = "median" | "p95" | "p99";
type HistoryMetric = "aps" | "task" | "screenshot";

const HISTORY_METRICS: { key: HistoryMetric; label: string }[] = [
  { key: "aps", label: "Actions/s" },
  { key: "task", label: "Task" },
  { key: "screenshot", label: "Screenshot" },
];

const PROVIDER_COLORS = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948",
  "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC", "#86BCB6", "#D37295",
];

const buttonClass = (active: boolean) =>
  `shrink-0 rounded-[3px] border px-3 py-1.5 text-[0.68rem] font-medium transition-colors ${
    active
      ? "border-foreground bg-foreground text-background"
      : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
  }`;

const formatDateLabel = (ymd: string) => {
  const [, month, day] = ymd.split("-");
  return month && day ? `${month}/${day}` : ymd;
};

const formatMs = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)} ms`;

const formatMetric = (metric: HistoryMetric, value: number) => metric === "aps" ? value.toFixed(2) : formatMs(value);

function tripleValue(triple: Triple | null, view: View): number | null {
  if (!triple || triple.samples === 0) return null;
  return triple[view];
}

function historyValue(point: ThroughputHistoryPoint, metric: HistoryMetric, view: View): number | null {
  if (metric === "aps") return tripleValue(point.actionsPerSecond, view);
  if (metric === "task") return tripleValue(point.taskMs, view);
  return tripleValue(point.screenshotMs, view);
}

function latencyDomain(values: number[]): [number, number] {
  const max = Math.max(0, ...values);
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const step = max >= 1000 ? 100 : max >= 100 ? 10 : 0.1;
  return [0, Math.ceil((max * 1.08) / step) * step];
}

export function BrowserThroughputCharts({
  providers,
  history,
  view,
}: {
  providers: BrowserThroughputProviderStats[];
  history: ThroughputHistory;
  view: View;
}) {
  const [range, setRange] = useState<HistoryRangeKey>("1w");
  const [metric, setMetric] = useState<HistoryMetric>("aps");
  const activeRange = HISTORY_RANGES.find((option) => option.key === range) ?? HISTORY_RANGES[0];
  const visibleDates = useMemo(
    () => filterDatesToRange(history.dates, activeRange.days, history.dates[0] ?? "1970-01-01"),
    [activeRange.days, history.dates]
  );
  const series = useMemo(
    () => history.providers
      .map((provider) => ({ ...provider, points: provider.points.filter((point) => visibleDates.includes(point.date)) }))
      .filter((provider) => provider.points.length > 0),
    [history.providers, visibleDates]
  );
  const config = useMemo(() => {
    const next: ChartConfig = {};
    series.forEach((provider, index) => {
      next[provider.provider] = { label: provider.displayName, color: PROVIDER_COLORS[index % PROVIDER_COLORS.length] };
    });
    providers.forEach((provider, index) => {
      if (!next[provider.provider]) next[provider.provider] = { label: provider.displayName, color: PROVIDER_COLORS[index % PROVIDER_COLORS.length] };
    });
    return next;
  }, [providers, series]);

  const lineData = useMemo(() => visibleDates.map((date) => {
    const row: Record<string, string | number | null> = { date, label: formatDateLabel(date) };
    for (const provider of series) {
      const point = provider.points.find((item) => item.date === date);
      row[provider.provider] = point ? historyValue(point, metric, view) : null;
    }
    return row;
  }), [metric, series, view, visibleDates]);

  const lineValues = lineData.flatMap((row) => series.map((provider) => row[provider.provider])).filter((value): value is number => typeof value === "number");
  const showDots = visibleDates.length <= 14;

  const barData = useMemo(() => AGENT_ACTION_TYPES.map((type) => {
    const row: Record<string, string | number | null> = { action: AGENT_ACTION_LABELS[type] };
    for (const provider of providers) {
      const triple = provider.perAction[type];
      row[provider.provider] = triple.samples > 0 ? triple[view] : null;
    }
    return row;
  }), [providers, view]);
  const barValues = barData.flatMap((row) => providers.map((provider) => row[provider.provider])).filter((value): value is number => typeof value === "number");
  const percentile = view === "median" ? "Median" : view.toUpperCase();

  return <div className={`${styles.charts} mt-12`}>
    <section className="flex min-w-0 flex-col">
      <BenchmarkSectionHeader chart title="History" description={`Showing ${visibleDates.length} run ${visibleDates.length === 1 ? "date" : "dates"} from the ${activeRange.label.toLowerCase()}.`} controls={<div className="flex flex-wrap gap-1.5" aria-label="History range">
        {HISTORY_RANGES.map((option) => <button key={option.key} type="button" aria-pressed={option.key === range} onClick={() => { setRange(option.key); track("history_range_selected", { benchmark: "browser-throughput", range: option.key }); }} className={buttonClass(option.key === range)}>{option.label}</button>)}
      </div>} />
      <div data-benchmark-panel="history" className="flex flex-1 flex-col rounded-[3px] border-[1.5px] border-foreground bg-background p-3 sm:p-4">
        <div data-panel-header>
          <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{HISTORY_METRICS.find((item) => item.key === metric)?.label}</h3>
          <p className="text-muted-foreground">{percentile} by run date. {metric === "aps" ? "Higher is better." : "Lower is better."}</p>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="History metric">
            {HISTORY_METRICS.map((item) => <button key={item.key} type="button" aria-pressed={item.key === metric} onClick={() => { setMetric(item.key); track("history_metric_selected", { benchmark: "browser-throughput", metric: item.key }); }} className={buttonClass(item.key === metric)}>{item.label}</button>)}
          </div>
        </div>
        {lineValues.length > 0 ? <ChartContainer config={config} className="aspect-auto! h-[260px] w-full">
          <LineChart data={lineData} margin={{ left: 0, right: 16, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 2" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} domain={latencyDomain(lineValues)} tickFormatter={(value) => formatMetric(metric, Number(value))} />
            <ChartTooltip content={({ active, payload }) => {
              const rows = (payload ?? []).filter((item) => typeof item.value === "number").sort((a, b) => Number(b.value) - Number(a.value));
              if (!active || rows.length === 0) return null;
              return <div className="grid min-w-[10rem] gap-1.5 rounded-none border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium">{String(rows[0]?.payload?.date ?? "")}</div>
                {rows.map((item) => <div key={String(item.dataKey)} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                  <span className="min-w-0 flex-1 text-muted-foreground">{String(config[String(item.dataKey)]?.label ?? item.dataKey ?? "")}</span>
                  <span className="font-mono font-medium tabular-nums">{formatMetric(metric, Number(item.value))}</span>
                </div>)}
              </div>;
            }} />
            <ChartLegend content={<ChartLegendContent />} />
            {series.map((provider) => <Line
              key={provider.provider}
              type="monotone"
              dataKey={provider.provider}
              stroke={`var(--color-${provider.provider})`}
              strokeWidth={2}
              connectNulls={false}
              dot={showDots ? { r: 2 } : ({ key, cx, cy, index }) => {
                const values = lineData.map((row) => {
                  const value = row[provider.provider];
                  return typeof value === "number" ? value : null;
                });
                if (typeof cx !== "number" || typeof cy !== "number" || !isIsolatedPoint(values, index ?? 0)) return <g key={key} />;
                return <circle key={key} cx={cx} cy={cy} r={2} fill="var(--background)" stroke={`var(--color-${provider.provider})`} strokeWidth={2} />;
              }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />)}
          </LineChart>
        </ChartContainer> : <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No measurements in this period.</p>}
      </div>
    </section>
    <section className="flex min-w-0 flex-col">
      <BenchmarkSectionHeader chart title="Results" description={`${percentile} latency of each action. Lower is better.`} />
      <div data-benchmark-panel="actions" className="flex flex-1 flex-col rounded-[3px] border-[1.5px] border-foreground bg-background p-3 sm:p-4">
        <div data-panel-header>
          <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">Per-action latency</h3>
          <p className="text-muted-foreground">One bar per provider, for the selected run day.</p>
        </div>
        {barValues.length > 0 ? <ChartContainer config={config} className="aspect-auto! h-[260px] w-full">
          <BarChart data={barData} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 2" />
            <XAxis dataKey="action" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={52} domain={latencyDomain(barValues)} tickFormatter={(value) => formatMs(Number(value))} />
            <ChartTooltip content={({ active, payload, label }) => {
              const rows = (payload ?? []).filter((item) => typeof item.value === "number").sort((a, b) => Number(a.value) - Number(b.value));
              if (!active || rows.length === 0) return null;
              return <div className="grid min-w-[10rem] gap-1.5 rounded-none border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium">{label}</div>
                {rows.map((item) => <div key={String(item.dataKey)} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                  <span className="min-w-0 flex-1 text-muted-foreground">{String(config[String(item.dataKey)]?.label ?? item.dataKey ?? "")}</span>
                  <span className="font-mono font-medium tabular-nums">{formatMs(Number(item.value))}</span>
                </div>)}
              </div>;
            }} />
            <ChartLegend content={<ChartLegendContent />} />
            {providers.map((provider) => <Bar key={provider.provider} dataKey={provider.provider} fill={`var(--color-${provider.provider})`} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
          </BarChart>
        </ChartContainer> : <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No successful actions on this day.</p>}
      </div>
    </section>
  </div>;
}
