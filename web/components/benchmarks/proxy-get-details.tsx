import { ChevronDown, ArrowUpRight } from "lucide-react";
import { proxyProviderColor } from "@/lib/proxy-violin";
import type { loadProxyGetHistory } from "@/lib/proxy-get-history";
import { proxyAttemptCost } from "@/lib/proxy-get-cost";

const ms = (value: number | null) => value === null ? "—" : `${value.toFixed(0)} ms`;
const usd = (value: number | null) => value === null ? "Unknown" : `$${value.toFixed(5)}`;

export function ProxyGetDetails({ result, overview = false }: { result: Awaited<ReturnType<typeof loadProxyGetHistory>>["overview"]; overview?: boolean }) {
  const { providers } = result;
  return <details id="methodology" className="mt-3 text-xs">
    <summary className="w-fit cursor-pointer text-muted-foreground underline underline-offset-2">Raw attempts & methodology</summary>
    <div className="mt-5 space-y-5">
        <p className="text-xs text-muted-foreground max-w-3xl">Ten attempts are exploratory; no tail percentile is inferred. Cost per success includes failed attempts. Prices are marginal usage estimates before subscriptions and credits. Browser-observed traffic excludes some billable overhead; provider meters are used when finalized. Unknown costs stay unknown.</p>
        <div className="rounded-[3px] border border-foreground/15 bg-card px-4 sm:px-6">
          <h3 className="pt-4 pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">Explore the data</h3>
          {providers.map(p => <details key={p.provider} className="group border-b border-foreground/10 last:border-b-0">
          <summary className="flex list-none items-center justify-between py-3 text-xs font-medium cursor-pointer [&::-webkit-details-marker]:hidden"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: proxyProviderColor(p.provider) }} />{p.displayName}<span className="hidden font-normal text-muted-foreground sm:inline">· Samples, failures & pricing</span></span><ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
          <p className="my-3 text-xs text-muted-foreground">{p.samples[0] && (proxyAttemptCost(p.samples[0]).pricing?.plan ?? "Pricing not configured")} · Rates checked {p.samples[0] && (proxyAttemptCost(p.samples[0]).pricing?.checkedAt ?? "—")}
            {p.samples[0] && proxyAttemptCost(p.samples[0]).pricing?.sourceUrls.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="ml-3 underline">Source {i + 1}</a>)}
          </p>
          <p className="my-3 text-xs text-muted-foreground">{p.costExplanation}</p>
          {overview && <p className="my-3 text-xs text-muted-foreground">Run date: <time dateTime={p.runDate}>{p.runDate}</time> · Target: <a href={p.samples[0]?.url} className="underline" target="_blank" rel="noopener noreferrer">{p.samples[0]?.url && new URL(p.samples[0].url).hostname}</a></p>}
          <div className="overflow-x-auto"><table className="w-full text-xs text-left tabular-nums">
            <caption className="sr-only">Raw attempts for {p.displayName}</caption>
            <thead><tr>{["Attempt", "Outcome", "Exit", "GET", "Bytes", "Cost", "Details"].map(h => <th key={h} scope="col" className="p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{p.samples.map((s, i) => <tr key={`${s.created_at}-${i}`} className="border-t border-border">
              <td className="p-2">{i + 1}</td><td className="p-2">{s.status}</td><td className="p-2">{s.observed_country ?? "—"}</td>
              <td className="p-2 whitespace-nowrap">{ms(s.get_ms)}</td><td className="p-2">{s.bytes_received.toLocaleString("en-US")}</td><td className="p-2" title={p.costExplanation}>{usd(proxyAttemptCost(s).cost_usd)}</td>
              <td className="p-2 min-w-56 break-words">{s.error_message ? `${s.error_stage}: ${s.error_message}` : "Payload verified"}
                {s.cleanup_error && <span className="block">Cleanup: {s.cleanup_error}</span>}
                {s.usage_error && <span className="block">{s.cost_reconciliation ? "Original usage read" : "Usage"}: {s.usage_error}</span>}
                {s.infrastructure_note && <span className="mt-1 block text-amber-700 dark:text-amber-400">Target infrastructure: {s.infrastructure_note}</span>}
                <span className="block text-muted-foreground">Create {ms(s.session_creation_ms)} · Connect {ms(s.session_connect_ms)} · Release {ms(s.session_release_ms)} · Traffic {proxyAttemptCost(s).transfer_bytes_source}</span>
                {s.cost_reconciliation && <span className="block text-muted-foreground">Reconciled {s.cost_reconciliation.checked_at.slice(0, 10)} · Original estimate: {usd(s.cost_usd)}</span>}
              </td>
            </tr>)}</tbody>
          </table></div>
        </details>)}</div>
      <section className="border-t border-foreground/15 pt-5 space-y-3">
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">What this measures</h3>
        {result.latestAt && <p className="text-[0.65rem] text-muted-foreground">Recorded: <time dateTime={result.latestAt}>{result.latestAt.slice(0, 10)}</time> · UTC</p>}
        <p className="text-xs leading-relaxed text-muted-foreground max-w-3xl">The browser → residential proxy → target path. Each sample uses a fresh session and verifies country before the GET. Country verification uses a separate destination; residential routing can change between destinations. Browser region and origin routing affect the result. {overview ? "The table shows each provider's latest suite up to the selected UTC day. Dates and target hosts may differ; each row retains its own samples and pricing. The charts show recorded daily results and compare matching workloads within each provider." : "The history compares matching workloads within each provider; daily results use the latest suite per provider on the selected UTC day."}</p>
        {providers.some(p => p.samples.some(s => s.infrastructure_note)) && <p className="max-w-3xl rounded-[3px] border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">A recorded failure coincided with an outage of the benchmark target&apos;s temporary tunnel. It remains in the attempt count; see the annotated sample for details before attributing it to a provider.</p>}
        {result.workload && <div className="flex flex-wrap gap-x-5 gap-y-2 text-[0.65rem] text-muted-foreground">
          <span>{result.workload.timeoutMs / 1000}s timeout · Origin connection warmed by setup</span>
          <a href={result.workload.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">Payload endpoint<ArrowUpRight className="size-3" /></a>
          <a href="https://github.com/nottelabs/browserarena/blob/main/docs/proxy-get.md" className="inline-flex items-center gap-1 underline underline-offset-2">Full methodology<ArrowUpRight className="size-3" /></a>
        </div>}
      </section>
    </div>
  </details>;
}
