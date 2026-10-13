"use client";
import { track } from "@/lib/analytics";
import { BenchmarkSectionHeader } from "./section-header";

import { useState } from "react";
import { useBenchmarkNavigation } from "./benchmark-navigation";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HISTORY_RANGES, rangeStartDate, type HistoryRangeKey } from "@/lib/history-range";
import { proxyProviderColor } from "@/lib/proxy-violin";
import type { ProxyHistoryDay } from "@/lib/proxy-get-history";
import { proxyHistoryChartData, proxyRollingAverage } from "@/lib/proxy-rolling-average";

const METRICS = [
  { key: "medianGetMs", label: "Complete GET" },
  { key: "medianFirstByteMs", label: "First byte" },
  { key: "costPerSuccessUsd", label: "Cost / success" },
] as const;
type Metric = (typeof METRICS)[number]["key"];
const buttonStyle = (active: boolean) => `rounded-[3px] border px-3 py-1.5 text-[0.68rem] font-medium transition-colors ${active
  ? "border-foreground bg-foreground text-background"
  : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"}`;
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const formatValue = (value: number, metric: Metric) => metric === "costPerSuccessUsd" ? `$${value.toFixed(5)}` : `${(value / 1000).toFixed(2)} s`;

export function ProxyHistoryChart({ days, dates, selectedDate, country, countryName, sort, workloadChangeDates, simulated, compact = false, rollingWindow = 0, basePath = "/test", sectioned = false }: {
  days: ProxyHistoryDay[]; dates: string[]; selectedDate: string; country: string; countryName: string;
  sort?: string; workloadChangeDates: string[];
  simulated: boolean;
  compact?: boolean; rollingWindow?: number; basePath?: string; sectioned?: boolean;
}) {
  const { pending, navigate } = useBenchmarkNavigation();
  const [range, setRange] = useState<HistoryRangeKey>("1m");
  const [metric, setMetric] = useState<Metric>("medianGetMs");
  const rangeDays = HISTORY_RANGES.find(r => r.key === range)!.days;
  // Anchor on the selected day when it is outside the latest window, so an
  // older day opened from a saved link remains visible in its history chart.
  const latest = dates.at(-1)!;
  const end = selectedDate < rangeStartDate(latest, rangeDays) ? selectedDate : latest;
  const start = rangeStartDate(end, rangeDays);
  const visibleDays = days.filter(d => d.date >= start && d.date <= end);
  const providers = [...new Map(days.flatMap(d => d.providers.filter(p => p.attempts > 0).map(p => [p.provider, p] as const))).values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const config = Object.fromEntries(providers.map(p => [p.provider, { label: p.displayName, color: proxyProviderColor(p.provider) }])) satisfies ChartConfig;
  const rolling = rollingWindow ? proxyRollingAverage(days, metric, rollingWindow) : [];
  const chart = proxyHistoryChartData(days, metric, rollingWindow || 1);
  const chartData = chart.data.filter(d => String(d.date) >= start && String(d.date) <= end);
  const metricDays = visibleDays.filter(d => d.providers.some(p => p[metric] !== null));
  const chooseDate = (date: string) => {
    const query = new URLSearchParams({ country, date });
    if (basePath !== "/proxy-get") { query.set("benchmark", "proxy-get"); query.set("demo", simulated ? "1" : "0"); }
    if (sort === "cost") query.set("sort", "cost");
    if (!pending) navigate(`${basePath}?${query}`);
  };

  const Heading = sectioned ? "h3" : "h2";
  return <section aria-label="Proxy Performance history" className={sectioned ? "flex min-w-0 flex-col" : `rounded-[3px] border-[1.5px] border-foreground bg-card ${compact ? "p-3" : "px-4 py-5 sm:px-6"}`}>
    {sectioned && <BenchmarkSectionHeader chart title="History" description={`Showing ${dates.filter(date => date >= start && date <= end).length} run ${dates.filter(date => date >= start && date <= end).length === 1 ? "date" : "dates"} from the ${HISTORY_RANGES.find(r => r.key === range)!.label.toLowerCase()}.`} controls={<div className="flex flex-wrap gap-1.5" aria-label="History range">
          {HISTORY_RANGES.map(r => <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => { setRange(r.key); track("history_range_selected", { benchmark: "proxy-performance", range: r.key }); }} className={buttonStyle(range === r.key)}>{r.label}</button>)}
      </div>} />}
    <div data-benchmark-panel={sectioned ? "history" : undefined} className={sectioned ? "flex flex-1 flex-col" : undefined}>
    <div data-panel-header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Heading className={`${sectioned ? "text-[0.72rem] uppercase tracking-widest" : compact ? "text-sm tracking-tight" : "tracking-tight"} font-semibold`}>{rollingWindow ? `${rollingWindow}-day rolling average` : "Performance over time"}</Heading>
        <p className={`mt-1 ${compact ? "text-[0.65rem]" : "text-xs"} text-muted-foreground`}>{sectioned ? `${metric === "costPerSuccessUsd" ? "Daily cost estimates" : "Daily medians"} · ` : `${countryName} · `}
          {workloadChangeDates.length > 0 ? <Popover><PopoverTrigger asChild><button type="button" className="underline underline-offset-2 hover:text-foreground">Changed workloads</button></PopoverTrigger>
            <PopoverContent className="max-w-[calc(100vw-32px)] text-xs">
              <p>All recorded days remain visible. Lines break and rolling averages restart when a provider’s target or workload changes. Inspect the first day of each new workload:</p>
              <div className="mt-3 flex flex-wrap gap-2">{workloadChangeDates.map(date => <button key={date} type="button" disabled={pending} onClick={() => chooseDate(date)} className="underline underline-offset-2 hover:text-foreground disabled:opacity-50">{dayLabel(date)}</button>)}</div>
            </PopoverContent>
          </Popover> : metric === "costPerSuccessUsd" ? "Lower is cheaper" : "Lower is faster"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="History metric">
        {METRICS.map(m => <button key={m.key} type="button" aria-pressed={metric === m.key} onClick={() => { setMetric(m.key); track("history_metric_selected", { benchmark: "proxy-performance", metric: m.key }); }} className={buttonStyle(metric === m.key)}>{m.label}</button>)}
      </div>
    </div>
    {!sectioned && <div className={`${compact ? "mt-2" : "mt-4"} flex flex-wrap items-center justify-between gap-3`}>
      <div className="flex flex-wrap gap-1.5" aria-label="History range">
        {HISTORY_RANGES.map(r => <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => { setRange(r.key); track("history_range_selected", { benchmark: "proxy-performance", range: r.key }); }} className={buttonStyle(range === r.key)}>{r.label}</button>)}
      </div>
      {!compact && <label className="flex items-center gap-2 text-xs text-muted-foreground">Run day
        <select aria-label="Run day" value={selectedDate} disabled={pending} onChange={e => { chooseDate(e.target.value); track("run_day_selected", { benchmark: "proxy-performance", date: e.target.value }); }} className="rounded-[3px] border border-foreground/25 bg-background px-2 py-1.5 text-foreground">
          {[...dates].reverse().map(date => <option key={date} value={date}>{dayLabel(date)}{date === latest ? " (latest)" : ""}</option>)}
        </select>
      </label>}
    </div>}
    {providers.length > 0 && metricDays.length > 0 ? <ChartContainer config={config} className={`${compact ? "mt-2 h-[160px]" : "mt-4 h-[260px]"} aspect-auto! w-full`}>
      <LineChart data={chartData} margin={{ left: 0, right: 20, top: 12, bottom: 8 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="2 2" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} tickFormatter={date => String(date).slice(5).replace("-", "/")} padding={{ left: 16, right: 16 }} />
        <YAxis width={metric === "costPerSuccessUsd" ? 78 : 52} tickLine={false} axisLine={false} tickMargin={8} domain={[0, "auto"]} tickFormatter={value => metric === "costPerSuccessUsd" ? `$${Number(value).toFixed(4)}` : `${(Number(value) / 1000).toFixed(1)}s`} />
        <ReferenceLine x={selectedDate} stroke="var(--foreground)" strokeOpacity={0.3} strokeDasharray="3 3" />
        <ChartTooltip content={({ active, label }) => {
          const day = visibleDays.find(d => d.date === label);
          if (!active || !day) return null;
          return <div className="min-w-52 rounded-[3px] border border-foreground/25 bg-background px-3 py-2 text-xs shadow-lg">
            <p className="mb-2 font-semibold">{dayLabel(day.date)}</p>
            {providers.map(p => {
              const sample = day.providers.find(s => s.provider === p.provider);
              const rollingPoint = rolling.find(r => r.date === day.date)?.providers.find(s => s.provider === p.provider);
              const value = rollingWindow ? rollingPoint?.value : sample?.[metric];
              return <div key={p.provider} className="flex items-center justify-between gap-4 py-1">
                <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: proxyProviderColor(p.provider) }} />{p.displayName}</span>
                <span className="text-right tabular-nums">{value == null ? "—" : formatValue(value, metric)}{sample && <span className="block text-[0.6rem] text-muted-foreground">{rollingWindow ? `${rollingPoint?.count ?? 0} days · daily ${sample[metric] == null ? "—" : formatValue(sample[metric]!, metric)}` : `${sample.successes}/${sample.attempts} successful`}</span>}</span>
              </div>;
            })}
            <p className="mt-2 text-[0.65rem] text-muted-foreground">Click a point to view this day&apos;s distributions.</p>
          </div>;
        }} />
        {chart.series.map(line => {
          const p = providers.find(provider => provider.provider === line.provider);
          if (!p) return null;
          return <Line key={line.dataKey} dataKey={line.dataKey} name={p.displayName} stroke={proxyProviderColor(p.provider)} strokeWidth={2} type="linear" connectNulls={false} isAnimationActive={false}
          dot={({ cx, cy, payload, value }) => {
            if (typeof cx !== "number" || typeof cy !== "number" || value == null) return <g />;
            const date = String(payload.date);
            return <g role="link" tabIndex={0} aria-label={`View ${p.displayName} results for ${dayLabel(date)}: ${formatValue(Number(value), metric)}`} className="cursor-pointer outline-none focus-visible:[&_circle:last-child]:stroke-foreground"
              onClick={() => chooseDate(date)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseDate(date); } }}>
              <circle cx={cx} cy={cy} r={10} fill="transparent" />
              <circle cx={cx} cy={cy} r={date === selectedDate ? 4 : 3} fill="var(--background)" stroke={proxyProviderColor(p.provider)} strokeWidth={2} />
            </g>;
          }} activeDot={false} />;
        })}
      </LineChart>
    </ChartContainer> : <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">{metric === "costPerSuccessUsd" ? "No known cost estimates in this period." : "No successful measurements in this period."}</p>}
    <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[0.68rem] text-muted-foreground">
      {providers.map(p => <span key={p.provider} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[1px]" style={{ background: proxyProviderColor(p.provider) }} />{p.displayName}</span>)}
    </div>
    {!sectioned && (compact ? <p className="mt-2 border-t border-foreground/10 pt-2 text-[0.6rem] text-muted-foreground" aria-live="polite">{pending ? "Loading day…" : rollingWindow ? `Average of available daily ${metric === "costPerSuccessUsd" ? "cost estimates" : "medians"} over ${rollingWindow} calendar days; early windows are partial. Click a point to inspect that day.` : "Click a point to inspect that day."}</p> : <div className="mt-4 border-t border-foreground/10 pt-3 text-[0.65rem] leading-relaxed text-muted-foreground" aria-live="polite">
      <p>{pending ? "Loading run details…" : metricDays.length === 1 ? "One measured day so far. More published runs will form the time series." : "Click a point or choose a run day to inspect its violin plot and raw attempts below."}</p>
      <p className="mt-1">{simulated ? "Simulated daily samples for layout preview." : "Latest suite per provider per UTC day. Missing measurements stay as gaps."} {metric === "costPerSuccessUsd" ? "Cost includes failed attempts; unknown costs remain gaps." : "Failed attempts appear in the daily results, but have no successful latency."}</p>
    </div>)}
    </div>
  </section>;
}
