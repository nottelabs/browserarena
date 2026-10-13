import Link from "next/link";
import { COUNTRY_NAMES, PROXY_COUNTRIES } from "@/lib/proxy-get";
import { loadTestProxyHistory } from "./proxy-demo";
import { ProxyViolinChart } from "@/components/proxy-violin-chart";
import { PROVIDERS_BY_ID } from "@/lib/providers";
import { proxyProviderColor } from "@/lib/proxy-violin";
import { ArrowDownToLine, ArrowUpRight, ChevronDown } from "lucide-react";
import { ProxyHistoryChart } from "./proxy-history-chart";

function ms(value: number | null) { return value === null ? "—" : `${value.toFixed(0)} ms`; }
function usd(value: number | null) { return value === null ? "Unknown" : `$${value.toFixed(5)}`; }

export async function TestProxyResults({ country, sort, date, simulated }: { country: (typeof PROXY_COUNTRIES)[number]; sort?: string; date?: string; simulated: boolean }) {
  const params = { sort };
  const history = await loadTestProxyHistory(country, date, simulated);
  const result = history.selected;
  const selectedDate = history.selectedDate;
  const modeQuery = `&demo=${simulated ? "1" : "0"}`;
  const dateQuery = `${selectedDate ? `&date=${selectedDate}` : ""}${modeQuery}`;
  const dateLabel = selectedDate ? new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  const providers = [...result.providers];
  if (params.sort === "cost") providers.sort((a, b) => (a.costPerSuccessUsd ?? Infinity) - (b.costPerSuccessUsd ?? Infinity));
  const attempts = providers.reduce((sum, p) => sum + p.attempts, 0);
  const successes = providers.reduce((sum, p) => sum + p.successes, 0);
  const fastest = [...providers].filter(p => p.medianGetMs !== null).sort((a, b) => a.medianGetMs! - b.medianGetMs!)[0];
  return <>
    <section id="leaderboard" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-foreground/15 bg-background px-4 py-3 text-xs">
        <p className="text-muted-foreground">{simulated ? <><span className="mr-2 rounded-[2px] bg-primary/20 px-2 py-1 font-medium text-foreground">Simulated preview</span>14 days based on recorded samples. Generated values for layout only.</> : "Recorded benchmark results"}</p>
        <Link href={`/test?benchmark=proxy-get&country=${country}&demo=${simulated ? "0" : "1"}`} className="shrink-0 rounded-[3px] border border-foreground/25 px-3 py-1.5 text-muted-foreground hover:border-foreground/50 hover:text-foreground">{simulated ? "Show recorded data" : "Show simulated history"}</Link>
      </div>
      {selectedDate && <ProxyHistoryChart key={`${country}-${simulated}`} days={history.days} dates={history.dates} selectedDate={selectedDate} country={country} countryName={COUNTRY_NAMES[country]} sort={sort} workloadChangeDates={history.workloadChangeDates} simulated={simulated} />}
      {selectedDate && <div className="flex flex-wrap items-center justify-between gap-3" id="proxy-daily-results">
        <h2 className="text-sm font-semibold">{simulated ? "Simulated daily results" : "Daily results"} <span className="ml-2 font-normal text-muted-foreground">{dateLabel}</span></h2>
        {selectedDate !== history.dates.at(-1) && <Link href={`/test?benchmark=proxy-get&country=${country}${modeQuery}`} className="text-xs text-muted-foreground underline underline-offset-2">Back to latest {simulated ? "day" : "run"}</Link>}
      </div>}
      {providers.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-[3px] border border-foreground/15 bg-primary/10 px-4 py-3">
          <p className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Lowest observed median</p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{fastest ? `${(fastest.medianGetMs! / 1000).toFixed(2)} s` : "—"}</p>
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">{fastest?.displayName ?? "Awaiting successful samples"}</p>
        </div>
        <div className="rounded-[3px] border border-foreground/15 bg-card px-4 py-3">
          <p className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Successful downloads</p>
          <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{successes}<span className="ml-1 text-sm font-normal text-muted-foreground">/ {attempts}</span></p>
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">{providers.length} providers · {COUNTRY_NAMES[country]}</p>
        </div>
        <div className="col-span-2 rounded-[3px] border border-foreground/15 bg-card px-4 py-3 sm:col-span-1">
          <p className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Same workload, every time</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{((result.workload?.bytes ?? 1048576) / 1024 / 1024).toFixed(0)} MiB<span className="ml-2 text-sm font-normal text-muted-foreground">GET</span></p>
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">Creation and release excluded</p>
        </div>
      </div>}
      {providers.length === 0 ? <div className="rounded-[3px] border border-border p-6 space-y-3">
        <h3 className="font-medium">No Proxy Performance results for {COUNTRY_NAMES[country]}{dateLabel ? ` on ${dateLabel}` : " yet"}</h3>
        <p className="text-sm text-muted-foreground">{selectedDate ? "No measurements were recorded for this country in the selected suites. Choose another run day or country." : "Results will appear once a run is published."}</p>
      </div> : <>
        <ProxyViolinChart providers={providers} countryName={COUNTRY_NAMES[country]} timeoutMs={result.workload?.timeoutMs ?? 30000} />
        <div className="pt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">The numbers</h3>
            <div className="flex flex-wrap items-center gap-3">
            <nav className="flex gap-1 rounded-[3px] border border-foreground/20 p-0.5 text-[0.65rem] font-medium" aria-label="Sort results">
              <Link href={`/test?benchmark=proxy-get&country=${country}${dateQuery}`} className={`rounded-[2px] px-2.5 py-1.5 ${params.sort !== "cost" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Fastest GET</Link>
              <Link href={`/test?benchmark=proxy-get&country=${country}${dateQuery}&sort=cost`} className={`rounded-[2px] px-2.5 py-1.5 ${params.sort === "cost" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Lowest cost</Link>
            </nav>
              <a href={`${simulated ? "/test/export" : "/api/proxy-get"}?country=${country}${dateQuery}`} className="inline-flex items-center gap-2 rounded-[3px] border border-foreground/25 bg-background px-3 py-2 text-xs text-muted-foreground hover:border-foreground/50 hover:text-foreground"><ArrowDownToLine className="size-3.5" aria-hidden="true" />Export {simulated ? "simulated " : ""}results</a>
            </div>
          </div>
          <div className="overflow-x-auto rounded-[3px] border-[1.5px] border-foreground bg-card">
            <table className="w-full text-[0.72rem] text-left tabular-nums">
              <caption className="sr-only">Proxy Performance results and estimated cost in {COUNTRY_NAMES[country]}</caption>
              <thead className="border-b-[1.5px] border-foreground text-[0.6rem] text-muted-foreground"><tr>
                {["Provider", "Successful", "Median GET", "First byte", "Mbps", "Est. cost / success", "Est. run cost"].map(h => <th key={h} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>{providers.map(p => <tr key={p.provider} className={`border-b border-foreground/10 last:border-b-0 ${p.provider === fastest?.provider ? "bg-primary/8" : ""}`}>
                <th scope="row" className="px-4 py-3 font-medium min-w-44"><a href={p.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline">
                  {PROVIDERS_BY_ID[p.provider]?.logo && <img src={PROVIDERS_BY_ID[p.provider].logo} alt="" className="size-5 rounded-[2px] object-contain" />}
                  {p.displayName}<span className="size-1.5 rounded-full" style={{ background: proxyProviderColor(p.provider) }} /></a></th>
                {p.status === "unsupported" ? <td colSpan={6} className="px-4 py-3 text-muted-foreground">Country proxy integration not verified</td> : <>
                  <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-flex rounded-[3px] px-2 py-1 text-[0.65rem] ${p.successes === p.attempts ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>{p.successes} / {p.attempts}</span></td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">{ms(p.medianGetMs)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{ms(p.medianFirstByteMs)}</td>
                  <td className="px-4 py-3">{p.medianMbps?.toFixed(2) ?? "—"}</td>
                  <td className="px-4 py-3">{usd(p.costPerSuccessUsd)}</td>
                  <td className="px-4 py-3">{usd(p.totalCostUsd)}</td>
                </>}
              </tr>)}</tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-muted-foreground max-w-3xl">Ten attempts are exploratory; no tail percentile is inferred. Cost per success includes failed attempts. Prices are marginal usage estimates before subscriptions and credits. Browser-observed traffic excludes some billable overhead; provider meters are used when finalized. Unknown costs stay unknown.</p>
        <div className="rounded-[3px] border border-foreground/15 bg-card px-4 sm:px-6">
          <h3 className="pt-4 pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">Explore the data</h3>
          {providers.map(p => <details key={p.provider} className="group border-b border-foreground/10 last:border-b-0">
          <summary className="flex list-none items-center justify-between py-3 text-xs font-medium cursor-pointer [&::-webkit-details-marker]:hidden"><span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: proxyProviderColor(p.provider) }} />{p.displayName}<span className="hidden font-normal text-muted-foreground sm:inline">· Samples, failures & pricing</span></span><ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
          <p className="my-3 text-xs text-muted-foreground">{p.samples[0]?.pricing?.plan ?? "Pricing not configured"} · Rates checked {p.samples[0]?.pricing?.checkedAt ?? "—"}
            {p.samples[0]?.pricing?.sourceUrls.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="ml-3 underline">Source {i + 1}</a>)}
          </p>
          <div className="overflow-x-auto"><table className="w-full text-xs text-left tabular-nums">
            <caption className="sr-only">Raw attempts for {p.displayName}</caption>
            <thead><tr>{["Attempt", "Outcome", "Exit", "GET", "Bytes", "Cost", "Details"].map(h => <th key={h} scope="col" className="p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{p.samples.map((s, i) => <tr key={`${s.created_at}-${i}`} className="border-t border-border">
              <td className="p-2">{i + 1}</td><td className="p-2">{s.status}</td><td className="p-2">{s.observed_country ?? "—"}</td>
              <td className="p-2 whitespace-nowrap">{ms(s.get_ms)}</td><td className="p-2">{s.bytes_received.toLocaleString("en-US")}</td><td className="p-2">{usd(s.cost_usd)}</td>
              <td className="p-2 min-w-56 break-words">{s.error_message ? `${s.error_stage}: ${s.error_message}` : simulated ? "Simulated successful download" : "Payload verified"}
                {s.cleanup_error && <span className="block">Cleanup: {s.cleanup_error}</span>}
                {s.usage_error && <span className="block">Usage: {s.usage_error}</span>}
                {s.infrastructure_note && <span className="mt-1 block text-amber-700 dark:text-amber-400">Target infrastructure: {s.infrastructure_note}</span>}
                <span className="block text-muted-foreground">Create {ms(s.session_creation_ms)} · Connect {ms(s.session_connect_ms)} · Release {ms(s.session_release_ms)} · Traffic {s.transfer_bytes_source}</span>
              </td>
            </tr>)}</tbody>
          </table></div>
        </details>)}</div>
      </>}
      <section className="border-t border-foreground/15 pt-5 space-y-3">
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">What this measures</h3>
        {result.latestAt && <p className="text-[0.65rem] text-muted-foreground">{simulated ? "Simulated day" : "Recorded"}: <time dateTime={result.latestAt}>{result.latestAt.slice(0, 10)}</time> · UTC</p>}
        <p className="text-xs leading-relaxed text-muted-foreground max-w-3xl">The browser → residential proxy → target path, with the same payload and timeout. Each sample uses a fresh session and verifies country before the GET. Country verification uses a separate destination; residential routing can change between destinations. Browser region and origin routing affect the result. The history compares matching workloads within each provider; daily results use the latest suite per provider on the selected UTC day.</p>
        {providers.some(p => p.samples.some(s => s.infrastructure_note)) && <p className="max-w-3xl rounded-[3px] border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">A recorded failure coincided with an outage of the benchmark target&apos;s temporary tunnel. It remains in the attempt count; see the annotated sample for details before attributing it to a provider.</p>}
        {result.workload && <div className="flex flex-wrap gap-x-5 gap-y-2 text-[0.65rem] text-muted-foreground">
          <span>{result.workload.timeoutMs / 1000}s timeout · Origin connection warmed by setup</span>
          <a href={result.workload.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">Payload endpoint<ArrowUpRight className="size-3" /></a>
          <a href="https://github.com/nottelabs/browserarena/blob/main/docs/proxy-get.md" className="inline-flex items-center gap-1 underline underline-offset-2">Full methodology<ArrowUpRight className="size-3" /></a>
        </div>}
      </section>
    </section>
  </>;
}
