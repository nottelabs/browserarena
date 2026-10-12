"use client";
import { track } from "@/lib/analytics";

import { useState } from "react";
import { Check, Circle, Download, Timer } from "lucide-react";
import type { ProxyGetStats } from "@/lib/proxy-get";
import { PROVIDERS_BY_ID } from "@/lib/providers";
import { proxyProviderColor, violinBandwidth, violinPath } from "@/lib/proxy-violin";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Metric = "get_ms" | "first_byte_ms";
const JITTER = [-10, 5, -2, 11, -6, 8, 0, -12, 3, 13];
function duration(ms: number) { return `${(ms / 1000).toFixed(2)} s`; }
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function ProxyViolinChart({ providers, countryName, timeoutMs }: {
  providers: ProxyGetStats[]; countryName: string; timeoutMs: number;
}) {
  const [metric, setMetric] = useState<Metric>("get_ms");
  const [showSamples, setShowSamples] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const groups = providers.map(p => ({ ...p, values: p.samples.flatMap(s => s.status === "success" && s[metric] !== null ? [s[metric]!] : []) }));
  const values = groups.flatMap(p => p.values);
  const max = Math.max(timeoutMs, ...values, 1000);
  const domain = Math.ceil(max / 5000) * 5000;
  const bandwidth = violinBandwidth(values, domain);
  const ticks = Array.from({ length: 7 }, (_, i) => i / 6 * domain);
  const position = (v: number) => `${v / domain * 100}%`;
  const highlighted = groups.find(p => p.provider === active);

  return <section aria-label="Provider latency distributions" className="rounded-[3px] border-[1.5px] border-foreground bg-card overflow-hidden">
    <div className="flex flex-col gap-4 border-b border-foreground/15 px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div>
        <h3 className="font-semibold tracking-tight">Download time distribution</h3>
        <p className="mt-1 text-xs text-muted-foreground">{countryName} <span className="mx-1.5 text-foreground/25">/</span> Lower is faster. Every provider uses the same axis.</p>
      </div>
      <div className="flex gap-1 rounded-[3px] border border-foreground/20 p-1 text-[0.7rem] font-medium" aria-label="Latency metric">
        {([{ key: "get_ms", label: "Complete GET", icon: Download }, { key: "first_byte_ms", label: "First byte", icon: Timer }] as const).map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}
          className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 transition-colors ${metric === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}><Icon className="size-3" />{label}</button>)}
      </div>
    </div>
    <div className="px-4 pt-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[0.65rem] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-[50%] border border-foreground/40 bg-primary/40" />Estimated density</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" />Median</span>
        </div>
        <button type="button" aria-pressed={showSamples} onClick={() => { track("raw_samples_toggled", { benchmark: "proxy-performance", shown: !showSamples }); setShowSamples(v => !v); }} className="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/20 px-2 py-1 hover:border-foreground/50">
          {showSamples ? <Check className="size-3" /> : <Circle className="size-3" />}Raw samples
        </button>
      </div>
      <div className="hidden sm:grid grid-cols-[170px_minmax(0,1fr)_90px] items-end gap-4 border-b border-foreground/10 pb-3 text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Provider</span>
        <div className="relative h-4 normal-case font-mono tracking-normal">{ticks.map((t, i) => <span key={i} className="absolute whitespace-nowrap" style={{ left: position(t), transform: i === 0 ? undefined : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{(t / 1000).toFixed(0)}s</span>)}</div>
        <span className="text-right">Median</span>
      </div>
      <div className="relative h-5 border-b border-foreground/10 text-[0.62rem] font-mono text-muted-foreground sm:hidden">{ticks.map((t, i) => <span key={i} className="absolute" style={{ left: position(t), transform: i === 0 ? undefined : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{(t / 1000).toFixed(0)}s</span>)}</div>
      <div onMouseLeave={() => setActive(null)}>{groups.map((p, index) => {
        const color = proxyProviderColor(p.provider), path = violinPath(p.values, domain, bandwidth);
        const middle = p.values.length ? median(p.values) : null;
        return <div key={p.provider} onMouseEnter={() => setActive(p.provider)} onFocus={() => setActive(p.provider)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null); }}
          className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-foreground/8 py-3 sm:grid-cols-[170px_minmax(0,1fr)_90px] sm:py-0">
          <div className="col-start-1 row-start-1 flex items-center gap-2.5 min-w-0">
            <span className="hidden w-3 text-[0.6rem] font-mono text-muted-foreground/60 sm:block">{String(index + 1).padStart(2, "0")}</span>
            <span className="inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-foreground/10 bg-background">
              {PROVIDERS_BY_ID[p.provider]?.logo ? <img src={PROVIDERS_BY_ID[p.provider].logo} alt="" className="size-6 object-contain" /> : <span className="size-2 rounded-full" style={{ background: color }} />}
            </span>
            <div className="min-w-0"><span className="block truncate text-xs font-semibold">{p.displayName}</span><span className="block text-[0.6rem] text-muted-foreground">{p.successes}/{p.attempts} successful</span></div>
          </div>
          <div className="relative col-span-2 row-start-2 h-16 sm:col-span-1 sm:col-start-2 sm:row-start-1" style={{ opacity: active && active !== p.provider ? 0.5 : 1, transition: "opacity 150ms" }}>
            <svg viewBox="0 0 800 64" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
              {ticks.map((_, i) => <line key={i} x1={i / 6 * 800} x2={i / 6 * 800} y1="0" y2="64" stroke="var(--foreground)" strokeOpacity="0.08" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />)}
              {path && <path d={path} fill={color} fillOpacity="0.28" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
            </svg>
            {middle !== null && <span aria-hidden="true" className="absolute top-[21px] h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-foreground" style={{ left: position(middle) }} />}
            {showSamples && p.values.map((v, i) => <Tooltip key={i}>
              <TooltipTrigger asChild><button type="button" aria-label={`${p.displayName}, successful sample ${i + 1}: ${duration(v)}`} className="absolute z-10 size-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-background outline-none transition-transform hover:scale-150 focus-visible:scale-150 focus-visible:ring-2 focus-visible:ring-foreground/40" style={{ left: position(v), top: 32 + JITTER[i % JITTER.length], background: color }} /></TooltipTrigger>
              <TooltipContent><span className="font-semibold">{p.displayName}</span><span className="ml-3 font-mono">{duration(v)}</span><span className="mt-1 block text-[0.65rem] opacity-70">Successful sample {i + 1} · {metric === "get_ms" ? "Complete GET" : "First byte"}</span></TooltipContent>
            </Tooltip>)}
            {!p.values.length && <span className="absolute inset-0 flex items-center text-[0.65rem] text-muted-foreground">{p.status === "unsupported" ? "Proxy not supported" : "No successful downloads"}</span>}
          </div>
          <div className="col-start-2 row-start-1 text-right sm:col-start-3 sm:row-start-1"><span className="text-sm font-semibold tabular-nums">{middle === null ? "—" : duration(middle)}</span><span className="hidden text-[0.6rem] text-muted-foreground sm:block">{p.values.length ? `${duration(Math.min(...p.values))} – ${duration(Math.max(...p.values))}` : "No samples"}</span></div>
        </div>;
      })}</div>
      <div className="relative mt-2 h-5 text-[0.62rem] font-mono text-muted-foreground sm:ml-[186px] sm:mr-[106px]">{ticks.map((t, i) => <span key={i} className="absolute" style={{ left: position(t), transform: i === 0 ? undefined : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{(t / 1000).toFixed(0)}s</span>)}</div>
    </div>
    <div className="mt-3 flex min-h-12 flex-wrap items-center justify-between gap-2 border-t border-foreground/10 bg-muted/40 px-4 py-3 text-[0.65rem] text-muted-foreground sm:px-6" aria-live="polite">
      <span>{highlighted ? <><span className="mr-2 inline-block size-2 rounded-full" style={{ background: proxyProviderColor(highlighted.provider) }} /><span className="font-semibold text-foreground">{highlighted.displayName}</span><span className="mx-2">·</span>{highlighted.successes} of {highlighted.attempts} attempts succeeded</> : "Hover or focus a sample to inspect its exact time."}</span>
      <span>Smoothing is exploratory. Fewer than 3 samples show points only.</span>
    </div>
  </section>;
}
