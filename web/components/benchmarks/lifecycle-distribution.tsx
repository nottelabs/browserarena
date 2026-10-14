"use client";

import { proxyProviderColor, violinBandwidth, violinPath } from "@/lib/proxy-violin";

export function LifecycleDistribution({ providers, dateLabel }: {
  providers: { provider: string; displayName: string; sessionMs: number[] }[];
  dateLabel: string;
}) {
  const groups = providers
    .map((provider) => {
      const values = provider.sessionMs.filter((value) => Number.isFinite(value));
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { ...provider, values, median };
    })
    .filter((provider) => provider.values.length > 0)
    .sort((a, b) => (a.median ?? Infinity) - (b.median ?? Infinity));
  const samples = groups.flatMap((provider) => provider.values);
  const max = Math.max(1, ...samples);
  const step = max > 10_000 ? 5_000 : max > 2_000 ? 1_000 : 500;
  const domain = Math.ceil(max / step) * step;
  const bandwidth = violinBandwidth(samples, domain);
  const ticks = Array.from({ length: 5 }, (_, index) => index / 4 * domain);
  const position = (value: number) => `${Math.min(value, domain) / domain * 100}%`;
  const seconds = (value: number) => `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;

  return <section data-benchmark-panel="distribution" aria-label="Session time distribution" className="flex min-w-0 flex-1 flex-col">
    <div data-panel-header>
      <h3 className="text-[0.72rem] font-semibold uppercase tracking-widest text-foreground">Sessions</h3>
      <p className="text-muted-foreground">{dateLabel}. Each dot is one successful session. The line is the median of those sessions.</p>
    </div>
    {groups.length === 0 ? <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No successful sessions on this day.</p> : <>
      <div data-violin-grid className="mt-3 grid grid-cols-[130px_minmax(0,1fr)_72px] items-end gap-3 border-b border-foreground/10 pb-2 text-[0.68rem] text-muted-foreground">
        <span>Provider</span>
        <div className="relative h-4 font-mono">{ticks.map((tick, index) => <span key={tick} className="absolute whitespace-nowrap" style={{ left: position(tick), transform: index === 0 ? undefined : index === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{seconds(tick)}</span>)}</div>
        <span className="text-right">Median</span>
      </div>
      <div className="flex flex-1 flex-col">{groups.map((provider) => {
        const color = proxyProviderColor(provider.provider);
        const path = violinPath(provider.values, domain, bandwidth);
        return <div data-violin-grid key={provider.provider} className="grid flex-1 grid-cols-[130px_minmax(0,1fr)_72px] items-center gap-3 border-b border-foreground/8 last:border-0" aria-label={`${provider.displayName}, ${provider.values.length} successful sessions, median ${provider.median == null ? "unavailable" : `${Math.round(provider.median)} ms`}`}>
          <div className="min-w-0"><span className="flex items-center gap-1.5 truncate text-xs font-medium"><span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />{provider.displayName}</span><span className="ml-3 mt-0.5 block text-[0.6rem] leading-3 text-muted-foreground">{provider.values.length} sessions</span></div>
          <div className="relative h-9">
            <svg viewBox="0 0 800 64" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
              {ticks.map((_, index) => <line key={index} x1={index / 4 * 800} x2={index / 4 * 800} y1={0} y2={64} stroke="var(--foreground)" strokeOpacity={0.08} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />)}
              {path && <path d={path} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
            </svg>
            {provider.median !== null && <span className="absolute top-[10px] h-4 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: position(provider.median) }} aria-hidden="true" />}
            {provider.values.map((value, index) => <span key={index} aria-hidden="true" className="absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background" style={{ left: position(value), top: 18 + ((index * 7) % 17 - 8), background: color }} />)}
          </div>
          <span className="text-right text-xs font-semibold tabular-nums">{provider.median === null ? "—" : `${Math.round(provider.median).toLocaleString("en-US")} ms`}</span>
        </div>;
      })}</div>
    </>}
  </section>;
}
