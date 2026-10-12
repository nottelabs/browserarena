import Link from "next/link";
import { COUNTRY_NAMES, type PROXY_COUNTRIES } from "@/lib/proxy-get";
import type { loadProxyGetHistory } from "@/lib/proxy-get-history";
import { PROVIDERS_BY_ID } from "@/lib/providers";
import { ProxyHistoryChart } from "./proxy-history-chart";
import { BenchmarkLink } from "./benchmark-navigation";
import { ProxyDailyDistribution } from "./proxy-daily-distribution";
import { ProxyDayPicker } from "./proxy-day-picker";
import { ProxyGetDetails } from "./proxy-get-details";
import { BenchmarkSectionHeader } from "./section-header";
import { BenchmarkTablePanel } from "./table-panel";
import styles from "./benchmark.module.css";

const milliseconds = (value: number | null) => value === null ? "N/A" : Math.round(value).toLocaleString("en-US");
const cost = (value: number | null) => value === null ? "Unknown" : `$${value.toFixed(5)}`;
const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const headers = [
  { label: "#" },
  { label: "Provider" },
  { label: "Runs", description: "Number of attempts in this provider's selected country suite, including failures." },
  { label: "Reliability (%)", description: "Percentage of attempts that passed country verification and completed a valid GET." },
  { label: "Latency (ms)", description: "Median complete GET time for successful attempts. Creation, connection, country verification, and release are excluded." },
  { label: "First byte (ms)", description: "Median time to the first response byte for successful GETs." },
  { label: "Throughput (Mbps)", description: "Median download throughput for successful GETs, in megabits per second." },
  { label: "Cost/success ($)", description: "Estimated cost of all attempts, including failures, divided by successful GETs." },
  { label: "Run cost ($)", description: "Estimated total cost of this provider's selected country suite, including failed attempts." },
];

export function ProxyDashboard({ history, country, preview = false, simulated = false, basePath = "/proxy-get", sort }: {
  history: Awaited<ReturnType<typeof loadProxyGetHistory>>;
  country: (typeof PROXY_COUNTRIES)[number];
  preview?: boolean;
  simulated?: boolean;
  basePath?: string;
  sort?: string;
}) {
  const providers = [...history.overview.providers];
  if (sort === "cost") providers.sort((a, b) => (a.costPerSuccessUsd ?? Infinity) - (b.costPerSuccessUsd ?? Infinity));
  const date = history.selectedDate;
  const dateLabel = date ? formatDate(date) : "No run";
  const query = new URLSearchParams({ country });
  if (preview) query.set("demo", simulated ? "1" : "0");
  if (date) query.set("date", date);
  if (sort === "cost") query.set("sort", "cost");
  const toggleQuery = new URLSearchParams({ country, demo: simulated ? "0" : "1" });
  const fastestQuery = new URLSearchParams(query);
  fastestQuery.delete("sort");
  const costQuery = new URLSearchParams(query);
  costQuery.set("sort", "cost");
  const exportQuery = new URLSearchParams(query);
  if (!simulated) exportQuery.set("view", "overview");
  const attempts = providers.reduce((a, p) => a + p.attempts, 0);
  const successes = providers.reduce((a, p) => a + p.successes, 0);
  const distributionTimeout = Math.max(0, ...providers.filter(p => p.attempts > 0).flatMap(p => p.samples.map(s => s.timeout_ms))) || 30000;

  return <>
      <div className={styles.tableStage}>
      <BenchmarkSectionHeader title="Benchmark" description={`Proxy GET · Latest runs (dates and targets vary) · ${successes}/${attempts} successful`} controls={<div className="flex flex-wrap items-center gap-3">
          {preview && <span data-badge>{simulated ? "Simulated preview · 14 days" : "Recorded data"}</span>}
          {preview && <BenchmarkLink data-control href={`${basePath}?${toggleQuery}`} className="rounded-[3px] border border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground">{simulated ? "Show recorded data" : "Simulate history"}</BenchmarkLink>}
          {!preview && <nav className="flex gap-1.5" aria-label="Sort results">
            <BenchmarkLink data-control href={`${basePath}?${fastestQuery}`} aria-current={sort !== "cost" ? "page" : undefined} className={`rounded-[3px] border ${sort !== "cost" ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"}`}>Fastest GET</BenchmarkLink>
            <BenchmarkLink data-control href={`${basePath}?${costQuery}`} aria-current={sort === "cost" ? "page" : undefined} className={`rounded-[3px] border ${sort === "cost" ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"}`}>Lowest cost</BenchmarkLink>
          </nav>}
          <a data-control href={`${preview && simulated ? "/test/export" : "/api/proxy-get"}?${exportQuery}`} className="rounded-[3px] border border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground">Export {simulated ? "simulation" : "results"}</a>
        </div>} />
      <BenchmarkTablePanel label="Proxy GET provider results">
        <div className={styles.tableScroll}>
        <table className="w-full text-left text-[0.78rem] tabular-nums" style={{ minWidth: 980 }}>
          <caption className="sr-only">{simulated ? "Simulated " : ""}Latest provider results for {COUNTRY_NAMES[country]} as of {dateLabel}; each row shows its recorded run date</caption>
          <colgroup><col /><col /><col style={{ width: "6%" }} /><col /><col /><col /><col style={{ width: "14%" }} /><col style={{ width: "13%" }} /><col /></colgroup>
          <thead><tr>{headers.map(h => <th key={h.label} scope="col" title={h.description} className="whitespace-nowrap">{h.label}</th>)}</tr></thead>
          <tbody>{providers.map((p, index) => <tr key={p.provider}>
            <td>{p.successes > 0 ? index + 1 : "—"}</td>
            <th scope="row"><a href={p.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 whitespace-nowrap hover:underline">
              {PROVIDERS_BY_ID[p.provider]?.logo && <span className={`inline-flex size-6 items-center justify-center overflow-hidden rounded-[3px] border border-border ${p.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}><img src={PROVIDERS_BY_ID[p.provider].logo} className="size-full object-contain" alt="" /></span>}<span className="flex flex-col gap-0.5"><span>{p.displayName}</span><time dateTime={p.runDate} className="text-[0.6rem] leading-3 font-normal text-muted-foreground">{formatDate(p.runDate)}</time></span></a></th>
            {p.status === "unsupported" ? <td colSpan={7} className="px-4 py-2 text-muted-foreground">Unavailable for this country</td> : <><td className="px-4 py-2">{p.attempts.toLocaleString("en-US")}</td><td className="px-4 py-2" title={`${p.successes}/${p.attempts} attempts succeeded`}>{(p.successes / p.attempts * 100).toFixed(1)}%</td>
            <td className="whitespace-nowrap px-4 py-2">{milliseconds(p.medianGetMs)}</td><td className="whitespace-nowrap px-4 py-2">{milliseconds(p.medianFirstByteMs)}</td>
            <td className="px-4 py-2">{p.medianMbps?.toFixed(2) ?? "N/A"}</td><td className="px-4 py-2" title={p.successes ? p.costExplanation : `No successful GETs; cost per success cannot be calculated. ${p.costExplanation}`}>{p.successes ? cost(p.costPerSuccessUsd) : "N/A"}</td><td className="px-4 py-2" title={p.costExplanation}>{cost(p.totalCostUsd)}</td></>}
          </tr>)}</tbody>
        </table>
        </div>
        {!providers.length && <p className="p-6 text-sm text-muted-foreground">No results for this country on the selected day.</p>}
      </BenchmarkTablePanel>
      </div>
      {date && <div className={styles.charts}>
        <ProxyHistoryChart days={history.days} dates={history.dates} selectedDate={date} country={country} countryName={COUNTRY_NAMES[country]} incompatibleDates={history.incompatibleDates} simulated={simulated} compact rollingWindow={7} basePath={basePath} sort={sort} sectioned />
        <section className="flex min-w-0 flex-col" aria-label="Results">
          <BenchmarkSectionHeader chart title="Results" description="Dots = samples · line = median · shape = estimated density." controls={
              <ProxyDayPicker basePath={basePath} sort={sort} dates={history.dates} selectedDate={date} country={country} simulated={simulated} />
          } />
          <ProxyDailyDistribution providers={providers} dateLabel={dateLabel} timeoutMs={distributionTimeout} />
        </section>
      </div>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{simulated ? "Simulated values. " : ""}Table and distributions: latest provider runs up to {dateLabel}; run dates and target hosts may differ. History: recorded days with matching workloads within each provider. Click a history point to inspect runs available by that day. GET excludes creation and release. Estimated costs include failed attempts. {preview && <Link href={`/test?benchmark=proxy-get&${query}`} className="underline underline-offset-2">Raw attempts & methodology</Link>}</p>
      {!preview && <ProxyGetDetails result={history.overview} overview />}
  </>;
}
