import Link from "next/link";
import { COUNTRY_NAMES, type PROXY_COUNTRIES } from "@/lib/proxy-get";
import type { loadProxyGetHistory } from "@/lib/proxy-get-history";
import { ProxyHistoryChart } from "./proxy-history-chart";
import { BenchmarkLink } from "./benchmark-navigation";
import { ProxyDailyDistribution } from "./proxy-daily-distribution";
import { ProxyDayPicker } from "./proxy-day-picker";
import { ProxyGetDetails } from "./proxy-get-details";
import { BenchmarkSectionHeader } from "./section-header";
import { ProxyLeaderboard } from "./proxy-leaderboard";
import styles from "./benchmark.module.css";

const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

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
  const exportQuery = new URLSearchParams(query);
  if (!simulated) exportQuery.set("view", "overview");
  const distributionTimeout = Math.max(0, ...providers.filter(p => p.attempts > 0).flatMap(p => p.samples.map(s => s.timeout_ms))) || 30000;

  return <>
      <ProxyLeaderboard providers={providers} countryName={COUNTRY_NAMES[country]} dateLabel={dateLabel} simulated={simulated} initialSort={sort} />
      {date && <div className={styles.charts}>
        <ProxyHistoryChart days={history.days} dates={history.dates} selectedDate={date} country={country} countryName={COUNTRY_NAMES[country]} workloadChangeDates={history.workloadChangeDates} simulated={simulated} compact rollingWindow={7} basePath={basePath} sort={sort} sectioned />
        <section className="flex min-w-0 flex-col" aria-label="Results">
          <BenchmarkSectionHeader chart title="Results" description="Dots = samples · line = median · shape = estimated density." controls={
              <ProxyDayPicker basePath={basePath} sort={sort} dates={history.dates} selectedDate={date} country={country} simulated={simulated} />
          } />
          <ProxyDailyDistribution providers={providers} dateLabel={dateLabel} timeoutMs={distributionTimeout} />
        </section>
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {preview && <span data-badge>{simulated ? "Simulated preview · 14 days" : "Recorded data"}</span>}
        {preview && <BenchmarkLink data-control href={`${basePath}?${toggleQuery}`} className="rounded-[3px] border border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground">{simulated ? "Show recorded data" : "Simulate history"}</BenchmarkLink>}
        <a data-control href={`${preview && simulated ? "/test/export" : "/api/proxy-get"}?${exportQuery}`} className="rounded-[3px] border border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground">Export {simulated ? "simulation" : "results"}</a>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{simulated ? "Simulated values. " : ""}Table and distributions: latest provider runs up to {dateLabel}; run dates and target hosts may differ. History: all recorded days; lines break and rolling averages restart when a provider’s target or workload changes. Click a history point to inspect runs available by that day. GET excludes creation and release. Estimated costs include failed attempts. Value scores are exploratory comparisons using the selected weights; dates and target hosts may differ. {preview && <Link href={`/test?benchmark=proxy-get&${query}`} className="underline underline-offset-2">Raw attempts & methodology</Link>}</p>
      {!preview && <ProxyGetDetails result={history.overview} overview />}
  </>;
}
