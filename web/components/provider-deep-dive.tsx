"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ExternalLink } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import styles from "@/components/benchmarks/benchmark.module.css";
import { ProxyViolinChart } from "@/components/proxy-violin-chart";
import { track, withNotteUtm } from "@/lib/analytics";
import { calendarDates, filterDatesToRange, HISTORY_RANGES, isIsolatedPoint, type HistoryRangeKey } from "@/lib/history-range";
import { hasSuccessfulRuns } from "@/lib/ranking";
import { proxyProviderColor } from "@/lib/proxy-violin";
import { AGENT_ACTION_LABELS, AGENT_ACTION_TYPES } from "@/lib/browser-throughput-shared";
import type { HistoricalProviderPoint } from "@/lib/data-shared";
import type { ProviderInfo } from "@/lib/providers";
import type { ActionPercentiles, PhaseSamples, ProviderLifecycle, ProviderProxy, ProviderThroughput } from "@/lib/provider-page-data";
import { COUNTRY_NAMES, PROXY_COUNTRIES } from "../../src/benchmarks/proxy-get/schema";

type LatencyView = "median" | "p95" | "p99";
type LifecycleMetric = "total" | "create" | "connect" | "goto" | "release";
type ThroughputMetric = "aps" | "task" | "screenshot";
type ProxyMetric = "get" | "byte" | "cost";

const LIFECYCLE_METRICS: { key: LifecycleMetric; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "create", label: "Create" },
  { key: "connect", label: "Connect" },
  { key: "goto", label: "Goto" },
  { key: "release", label: "Release" },
];

const THROUGHPUT_METRICS: { key: ThroughputMetric; label: string }[] = [
  { key: "aps", label: "Actions/s" },
  { key: "task", label: "Task" },
  { key: "screenshot", label: "Screenshot" },
];

const PROXY_METRICS: { key: ProxyMetric; label: string }[] = [
  { key: "get", label: "Complete GET" },
  { key: "byte", label: "First byte" },
  { key: "cost", label: "Cost / success" },
];

const PHASE_KEY: Record<LatencyView, Record<LifecycleMetric, keyof HistoricalProviderPoint>> = {
  median: { total: "totalTimeMs", create: "medianCreationMs", connect: "medianConnectMs", goto: "medianGotoMs", release: "medianReleaseMs" },
  p95: { total: "p95TotalMs", create: "p95CreationMs", connect: "p95ConnectMs", goto: "p95GotoMs", release: "p95ReleaseMs" },
  p99: { total: "p99TotalMs", create: "p99CreationMs", connect: "p99ConnectMs", goto: "p99GotoMs", release: "p99ReleaseMs" },
};

const buttonClass = (active: boolean) =>
  `shrink-0 rounded-[3px] border px-3 py-1.5 text-[0.68rem] font-medium transition-colors ${
    active
      ? "border-foreground bg-foreground text-background"
      : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
  }`;

const formatDay = (ymd: string) => {
  const [, month, day] = ymd.split("-");
  return month && day ? `${month}/${day}` : ymd;
};

const formatMs = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)} ms`;
const formatCost = (value: number) => `$${value.toFixed(5)}`;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(0, index)];
}

function summary(values: number[]) {
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

function domain(values: number[], stepFor: (max: number) => number): [number, number] {
  const max = Math.max(0, ...values.filter((value) => Number.isFinite(value)));
  if (max <= 0) return [0, 1];
  const step = stepFor(max);
  return [0, Math.ceil((max * 1.08) / step) * step];
}

function histogram(values: number[], format: (value: number) => string) {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const capIndex = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.9 * sorted.length) - 1));
  const cap = Math.max(sorted[capIndex] ?? 0, sorted[0] ?? 0);
  const raw = Math.max(cap, 1e-9) / 8;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / pow;
  const nice = (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * pow;
  const rows: { label: string; count: number }[] = [];
  for (let start = 0; start <= cap + nice * 0.001; start += nice) {
    const end = start + nice;
    const last = end > cap;
    const count = values.filter((value) => last ? value >= start : value >= start && value < end).length;
    const overflow = last && sorted[sorted.length - 1]! > cap;
    rows.push({ label: overflow ? `≥ ${format(start)}` : format(start), count });
    if (last) break;
  }
  return rows;
}

function MetricButtons<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
}) {
  return <div className="mt-3 flex flex-wrap gap-1.5" aria-label={label}>
    {options.map((option) => <button key={option.key} type="button" aria-pressed={option.key === value} onClick={() => onChange(option.key)} className={buttonClass(option.key === value)}>{option.label}</button>)}
  </div>;
}

function SeriesLine({ rows, color, metricLabel, format }: {
  rows: { label: string; value: number | null; gap?: boolean }[];
  color: string;
  metricLabel: string;
  format: (value: number) => string;
}) {
  // A workload change is a null point, so the line stops instead of joining the two targets.
  const plotted = rows.flatMap((row, index) => row.gap ? [{ label: `\u200b${index}`, value: null }, row] : [row]);
  const config = { value: { label: metricLabel, color } } satisfies ChartConfig;
  const values = plotted.map((row) => row.value);
  const [low, high] = domain(values.filter((value): value is number => typeof value === "number"), (max) => max >= 1000 ? 100 : max >= 100 ? 10 : max >= 1 ? 0.1 : 0.01);
  return <ChartContainer config={config} className="aspect-auto! h-[260px] w-full">
    <LineChart data={plotted} margin={{ left: 0, right: 16, top: 8 }}>
      <CartesianGrid vertical={false} strokeDasharray="2 2" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={(value) => String(value).startsWith("\u200b") ? "" : String(value)} />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} domain={[low, high]} tickFormatter={(value) => format(Number(value))} />
      <ChartTooltip content={<ChartTooltipContent formatter={(value) => format(Number(value))} />} />
      <Line
        type="monotone"
        dataKey="value"
        stroke="var(--color-value)"
        strokeWidth={2}
        isAnimationActive={false}
        dot={({ key, cx, cy, index }) => typeof cx === "number" && typeof cy === "number" && (plotted.length <= 14 || isIsolatedPoint(values, index ?? 0))
          ? <circle key={key} cx={cx} cy={cy} r={2} fill="var(--color-value)" />
          : <g key={key} />}
        connectNulls={false}
      />
    </LineChart>
  </ChartContainer>;
}

function Distribution({ values, color, format, noun }: {
  values: number[];
  color: string;
  format: (value: number) => string;
  noun: string;
}) {
  const rows = histogram(values, format);
  const config = { count: { label: noun, color } } satisfies ChartConfig;
  if (!rows.length) return <p className="py-16 text-center text-sm text-muted-foreground">No successful runs on this day.</p>;
  const peak = Math.max(1, ...rows.map((row) => row.count));
  return <ChartContainer config={config} className="aspect-auto! h-[260px] w-full">
    <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
      <CartesianGrid vertical={false} strokeDasharray="2 2" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} allowDecimals={false} domain={[0, peak]} />
      <ChartTooltip content={<ChartTooltipContent />} />
      <Bar dataKey="count" fill="var(--color-count)" isAnimationActive={false} radius={2} />
    </BarChart>
  </ChartContainer>;
}

function RangeButtons({ range, setRange, benchmark }: { range: HistoryRangeKey; setRange: (range: HistoryRangeKey) => void; benchmark: "session-performance" | "browser-throughput" | "proxy-performance" }) {
  return <div className="flex flex-wrap gap-1.5" aria-label="History range">
    {HISTORY_RANGES.map((option) => <button key={option.key} type="button" aria-pressed={option.key === range} onClick={() => { setRange(option.key); track("history_range_selected", { benchmark, range: option.key }); }} className={buttonClass(option.key === range)}>{option.label}</button>)}
  </div>;
}

function LifecycleSection({ data, color }: { data: ProviderLifecycle | null; color: string }) {
  const [range, setRange] = useState<HistoryRangeKey>("1w");
  const [metric, setMetric] = useState<LifecycleMetric>("total");
  const [view, setView] = useState<LatencyView>("median");
  const dates = useMemo(() => calendarDates(data?.points.map((point) => point.date) ?? []), [data]);
  const activeRange = HISTORY_RANGES.find((option) => option.key === range) ?? HISTORY_RANGES[0];
  const visible = useMemo(() => filterDatesToRange(dates, activeRange.days, dates[0] ?? "1970-01-01"), [activeRange.days, dates]);
  const samples = data?.samples[metric] ?? [];
  const stats = summary(samples);
  const rows = visible.map((date) => {
    const point = data?.points.find((item) => item.date === date);
    const raw = point && hasSuccessfulRuns(point) ? point[PHASE_KEY[view][metric]] : null;
    return { label: formatDay(date), value: typeof raw === "number" ? raw : null };
  });
  return <section id="lifecycle" className="mb-12 scroll-mt-24">
    <BenchmarkSectionHeader chart title="Browser Lifecycle" description={data ? `Showing ${visible.length} run ${visible.length === 1 ? "date" : "dates"} from the ${activeRange.label.toLowerCase()}.` : "No lifecycle runs for this provider."} controls={data ? <RangeButtons range={range} setRange={setRange} benchmark="session-performance" /> : undefined} />
    {data && <div className={styles.charts}>
      <section>
        <div data-benchmark-panel="history" className="flex h-full flex-col">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{LIFECYCLE_METRICS.find((item) => item.key === metric)?.label}</h3>
            <p className="text-muted-foreground">{data.runs ? `${((data.successes / data.runs) * 100).toFixed(1)}% success · ${data.successes}/${data.runs} runs${data.day ? ` · ${formatDay(data.day)}` : ""}` : "No measured runs on this day."} Lower is better.</p>
            <MetricButtons label="Lifecycle phase" value={metric} options={LIFECYCLE_METRICS} onChange={(key) => { setMetric(key); track("history_metric_selected", { benchmark: "session-performance", metric: key }); }} />
            <MetricButtons label="Percentile" value={view} options={(["median", "p95", "p99"] as const).map((key) => ({ key, label: `${key === "median" ? "Median" : key.toUpperCase()} ${stats[key] == null ? "—" : formatMs(stats[key])}` }))} onChange={(key) => { setView(key); track("percentile_selected", { benchmark: "session-performance", percentile: key }); }} />
          </div>
          <SeriesLine rows={rows} color={color} metricLabel={LIFECYCLE_METRICS.find((item) => item.key === metric)?.label ?? "Latency"} format={(value) => `${(value / 1000).toFixed(1)}s`} />
        </div>
      </section>
      <section>
        <div data-benchmark-panel="distribution" className="flex h-full flex-col">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">Sessions</h3>
            <p className="text-muted-foreground">{data.day ? `${formatDay(data.day)} · ` : ""}Successful {metric === "total" ? "sessions" : `${metric} times`}. Each bar is a count.</p>
          </div>
          <Distribution values={samples} color={color} format={formatMs} noun="Sessions" />
        </div>
      </section>
    </div>}
  </section>;
}

function ThroughputSection({ data, color }: { data: ProviderThroughput | null; color: string }) {
  const [range, setRange] = useState<HistoryRangeKey>("1w");
  const [metric, setMetric] = useState<ThroughputMetric>("aps");
  const [view, setView] = useState<LatencyView>("median");
  const dates = useMemo(() => calendarDates(data?.points.map((point) => point.date) ?? []), [data]);
  const activeRange = HISTORY_RANGES.find((option) => option.key === range) ?? HISTORY_RANGES[0];
  const visible = useMemo(() => filterDatesToRange(dates, activeRange.days, dates[0] ?? "1970-01-01"), [activeRange.days, dates]);
  const samples = metric === "aps" ? data?.actionsPerSecond ?? [] : metric === "task" ? data?.taskMs ?? [] : data?.screenshotMs ?? [];
  const stats = summary(samples);
  const format = metric === "aps" ? (value: number) => value.toFixed(2) : formatMs;
  const rows = visible.map((date) => {
    const point = data?.points.find((item) => item.date === date);
    const triple = !point ? null : metric === "aps" ? point.actionsPerSecond : metric === "task" ? point.taskMs : point.screenshotMs;
    return { label: formatDay(date), value: triple && triple.samples > 0 ? triple[view] : null };
  });
  const actionRows = AGENT_ACTION_TYPES.map((type) => {
    const action: ActionPercentiles | undefined = data?.actions[type];
    return { action: AGENT_ACTION_LABELS[type], value: action && action.samples > 0 ? action[view] : null };
  });
  return <section id="throughput" className="mb-12 scroll-mt-24">
    <BenchmarkSectionHeader chart title="Browser Throughput" description={data ? `Showing ${visible.length} run ${visible.length === 1 ? "date" : "dates"} from the ${activeRange.label.toLowerCase()}.` : "No throughput runs for this provider."} controls={data ? <RangeButtons range={range} setRange={setRange} benchmark="browser-throughput" /> : undefined} />
    {data && <div className={styles.charts}>
      <section>
        <div data-benchmark-panel="history" className="flex h-full flex-col">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{THROUGHPUT_METRICS.find((item) => item.key === metric)?.label}</h3>
            <p className="text-muted-foreground">{data.runs ? `${((data.successes / data.runs) * 100).toFixed(1)}% success · ${data.successes}/${data.runs} sessions${data.day ? ` · ${formatDay(data.day)}` : ""}` : "No measured sessions on this day."} {metric === "aps" ? "Higher is better." : "Lower is better."}</p>
            <MetricButtons label="Throughput metric" value={metric} options={THROUGHPUT_METRICS} onChange={(key) => { setMetric(key); track("history_metric_selected", { benchmark: "browser-throughput", metric: key }); }} />
            <MetricButtons label="Percentile" value={view} options={(["median", "p95", "p99"] as const).map((key) => ({ key, label: `${key === "median" ? "Median" : key.toUpperCase()} ${stats[key] == null ? "—" : format(stats[key])}` }))} onChange={(key) => { setView(key); track("percentile_selected", { benchmark: "browser-throughput", percentile: key }); }} />
          </div>
          <SeriesLine rows={rows} color={color} metricLabel={THROUGHPUT_METRICS.find((item) => item.key === metric)?.label ?? "Throughput"} format={format} />
        </div>
      </section>
      <section>
        <div data-benchmark-panel="distribution" className="flex h-full flex-col">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{metric === "screenshot" ? "Screenshot actions" : "Sessions"}</h3>
            <p className="text-muted-foreground">{data.day ? `${formatDay(data.day)} · ` : ""}{metric === "screenshot" ? "Successful screenshots." : "Successful sessions."} Each bar is a count.</p>
          </div>
          <Distribution values={samples} color={color} format={format} noun={metric === "screenshot" ? "Screenshots" : "Sessions"} />
        </div>
      </section>
      <section data-chart-span="row">
        <div data-benchmark-panel="ranking" className="flex flex-col">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">Per-action latency</h3>
            <p className="text-muted-foreground">{view === "median" ? "Median" : view.toUpperCase()} of each action{data.day ? ` on ${formatDay(data.day)}` : ""}. Lower is better.</p>
          </div>
          <ChartContainer config={{ value: { label: "Latency", color } }} className="aspect-auto! h-[280px] w-full">
            <BarChart data={actionRows} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 2" />
              <XAxis dataKey="action" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} domain={domain(actionRows.flatMap((row) => row.value == null ? [] : [row.value]), (max) => max >= 1000 ? 100 : 10)} tickFormatter={(value) => formatMs(Number(value))} />
              <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatMs(Number(value))} />} />
              <Bar dataKey="value" fill={color} isAnimationActive={false} radius={2} />
            </BarChart>
          </ChartContainer>
        </div>
      </section>
    </div>}
  </section>;
}

function ProxySection({ data, color, slug }: { data: ProviderProxy; color: string; slug: string }) {
  const [range, setRange] = useState<HistoryRangeKey>("1m");
  const [metric, setMetric] = useState<ProxyMetric>("get");
  const dates = data.history.map((day) => day.date);
  const activeRange = HISTORY_RANGES.find((option) => option.key === range) ?? HISTORY_RANGES[0];
  const visible = useMemo(() => filterDatesToRange(dates, activeRange.days, dates[0] ?? "1970-01-01"), [activeRange.days, dates]);
  const format = metric === "cost" ? formatCost : (value: number) => `${(value / 1000).toFixed(2)}s`;
  const rows = (() => {
    const plotted: { label: string; value: number | null; gap?: boolean }[] = [];
    let previousKey: string | null = null;
    for (const date of visible) {
      const day = data.history.find((item) => item.date === date);
      const value = !day ? null : metric === "get" ? day.medianGetMs : metric === "byte" ? day.medianFirstByteMs : day.costPerSuccessUsd;
      const gap = Boolean(day?.workloadKey && previousKey && day.workloadKey !== previousKey);
      if (day?.workloadKey) previousKey = day.workloadKey;
      plotted.push({ label: formatDay(date), value, gap });
    }
    return plotted;
  })();
  return <section id="proxy" className="scroll-mt-24">
    <BenchmarkSectionHeader chart title="Proxy Performance" description={data.status === "absent" ? "No proxy runs for this provider." : `${COUNTRY_NAMES[data.country]}. ${data.history.length ? `Showing ${visible.length} run ${visible.length === 1 ? "date" : "dates"} from the ${activeRange.label.toLowerCase()}.` : ""}`} controls={<div className="flex flex-wrap items-center gap-1.5">
      {PROXY_COUNTRIES.map((country) => <Link key={country} href={`/provider/${slug}?country=${country}#proxy`} prefetch={true} aria-current={country === data.country ? "page" : undefined} className={buttonClass(country === data.country)}>{country}</Link>)}
      {data.history.length > 0 && <RangeButtons range={range} setRange={setRange} benchmark="proxy-performance" />}
    </div>} />
    {data.status === "unsupported" && <p className="rounded-[3px] border-[1.5px] border-foreground bg-background px-4 py-6 text-sm text-muted-foreground">{data.note}</p>}
    {data.status === "measured" && <div className={styles.charts}>
      <section>
        <div data-benchmark-panel="history" className="flex h-full flex-col">
          <div data-panel-header>
            <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">{PROXY_METRICS.find((item) => item.key === metric)?.label}</h3>
            <p className="text-muted-foreground">{metric === "cost" ? "Estimated cost per successful GET." : "Median latency by run date. Lower is better."}</p>
            <MetricButtons label="Proxy metric" value={metric} options={PROXY_METRICS} onChange={(key) => { setMetric(key); track("history_metric_selected", { benchmark: "proxy-performance", metric: key }); }} />
          </div>
          {rows.some((row) => row.value != null) ? <SeriesLine rows={rows} color={color} metricLabel={PROXY_METRICS.find((item) => item.key === metric)?.label ?? "Proxy"} format={format} /> : <p className="py-16 text-center text-sm text-muted-foreground">No measured downloads in this range.</p>}
        </div>
      </section>
      <section>
        {data.stats ? <ProxyViolinChart providers={[data.stats]} countryName={COUNTRY_NAMES[data.country]} timeoutMs={data.stats.samples[0]?.timeout_ms ?? 30000} /> : <div data-benchmark-panel="distribution" className="flex h-full items-center justify-center"><p className="text-sm text-muted-foreground">No downloads on the latest day.</p></div>}
      </section>
    </div>}
  </section>;
}

export function ProviderDeepDive({ provider, slug, lifecycle, throughput, proxy }: {
  provider: ProviderInfo;
  slug: string;
  lifecycle: ProviderLifecycle | null;
  throughput: ProviderThroughput | null;
  proxy: ProviderProxy;
}) {
  const color = proxyProviderColor(provider.id);
  return <>
    <header className="mb-8 flex items-center gap-3">
      {provider.logo && <span className={`inline-flex size-10 items-center justify-center overflow-hidden rounded-[3px] ${provider.id === "NOTTE" ? "bg-black p-[2px]" : ""}`}><img src={provider.logo} alt="" decoding="sync" className="size-full object-contain" /></span>}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{provider.displayName}</h1>
        <a href={withNotteUtm(provider.url, "leaderboard")} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[0.75rem] text-muted-foreground hover:text-foreground">
          {provider.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
    </header>
    <LifecycleSection data={lifecycle} color={color} />
    <ThroughputSection data={throughput} color={color} />
    <ProxySection data={proxy} color={color} slug={slug} />
  </>;
}
