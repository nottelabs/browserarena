"use client";
import { track } from "@/lib/analytics";

import { useState } from "react";
import type { ProxyGetStats } from "@/lib/proxy-get";
import { proxyProviderColor, violinBandwidth, violinPath } from "@/lib/proxy-violin";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ProxyDailyDistribution({ providers, dateLabel, timeoutMs }: { providers: ProxyGetStats[]; dateLabel: string; timeoutMs: number }) {
  const [metric, setMetric] = useState<"get_ms" | "first_byte_ms">("get_ms");
  const groups = providers.filter(p => p.attempts > 0).map(p => ({ ...p, values: p.samples.flatMap(s => s.status === "success" && s[metric] !== null ? [s[metric]!] : []) }));
  const values = groups.flatMap(p => p.values);
  const domain = Math.ceil(Math.max(timeoutMs, ...values, 1000) / 5000) * 5000;
  const bandwidth = violinBandwidth(values, domain);
  const ticks = Array.from({ length: 5 }, (_, i) => i / 4 * domain);
  const position = (value: number) => `${value / domain * 100}%`;
  const duration = (value: number) => `${(value / 1000).toFixed(2)} s`;
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };

  return <section data-benchmark-panel="distribution" aria-label="Latest provider distributions" className="flex min-w-0 flex-1 flex-col">
    <div data-panel-header className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="text-[0.72rem] font-semibold uppercase tracking-widest">Daily distribution</h3><p className="mt-1 text-[0.65rem] text-muted-foreground">Latest provider runs · Successful downloads</p><span className="sr-only">Latest runs through {dateLabel}; run dates are shown per provider</span></div>
      <div className="flex gap-1.5" aria-label="Distribution metric">
        {(["get_ms", "first_byte_ms"] as const).map(m => <button key={m} type="button" aria-pressed={m === metric} onClick={() => { setMetric(m); track("history_metric_selected", { benchmark: "proxy-performance", metric: m }); }} className={`rounded-[3px] border px-2.5 py-1.5 text-[0.65rem] ${m === metric ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"}`}>{m === "get_ms" ? "Complete GET" : "First byte"}</button>)}
      </div>
    </div>
    <div data-violin-grid className="mt-3 grid grid-cols-[130px_minmax(0,1fr)_64px] items-end gap-3 border-b border-foreground/10 pb-2 text-[0.68rem] text-muted-foreground">
      <span>Provider</span>
      <div className="relative h-4 font-mono">{ticks.map((t, i) => <span key={t} className="absolute whitespace-nowrap" style={{ left: position(t), transform: i === 0 ? undefined : i === 4 ? "translateX(-100%)" : "translateX(-50%)" }}>{(t / 1000).toFixed(1)}s</span>)}</div>
      <span className="text-right">Median</span>
    </div>
    <div className="flex flex-1 flex-col">{groups.map(p => {
      const color = proxyProviderColor(p.provider);
      const path = violinPath(p.values, domain, bandwidth);
      const middle = p.values.length ? median(p.values) : null;
      return <div data-violin-grid key={p.provider} className="grid flex-1 grid-cols-[130px_minmax(0,1fr)_64px] items-center gap-3 border-b border-foreground/8 last:border-0">
        <div className="min-w-0"><span className="flex items-center gap-1.5 truncate text-xs font-medium"><span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />{p.displayName}</span><time dateTime={p.runDate} className="ml-3 mt-0.5 block text-[0.6rem] leading-3 text-muted-foreground">{new Date(`${p.runDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</time></div>
        <div className="relative h-[36px]">
          <svg viewBox="0 0 800 64" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
            {ticks.map((_, i) => <line key={i} x1={i / 4 * 800} x2={i / 4 * 800} y1={0} y2={64} stroke="var(--foreground)" strokeOpacity={0.08} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />)}
            {path && <path d={path} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
          </svg>
          {middle !== null && <span className="absolute top-[10px] h-4 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: position(middle) }} aria-hidden="true" />}
          {p.values.map((value, i) => <Tooltip key={i}>
            <TooltipTrigger asChild><button type="button" aria-label={`${p.displayName} sample ${i + 1}: ${duration(value)}`} className="absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background hover:scale-150 focus-visible:ring-2 focus-visible:ring-foreground" style={{ left: position(value), top: 18 + ((i * 7) % 17 - 8), background: color }} /></TooltipTrigger>
            <TooltipContent>{p.displayName} · {duration(value)} · Sample {i + 1}</TooltipContent>
          </Tooltip>)}
          {!p.values.length && <span className="absolute inset-0 flex items-center text-[0.6rem] text-muted-foreground">No successful samples</span>}
        </div>
        <span className="text-right text-xs font-semibold tabular-nums">{middle === null ? "—" : duration(middle)}</span>
      </div>;
    })}{!groups.length && <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No recorded attempts for this country.</p>}</div>
  </section>;
}
