import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import {
  loadHistoricalLeaderboard,
  loadLeaderboard,
  type PercentileType,
  type SortByType,
} from "@/lib/data";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { HistoryCharts } from "@/components/history-charts";
import styles from "@/components/benchmarks/benchmark.module.css";
import { BENCHMARK_TITLES, BenchmarkTitle } from "@/components/benchmarks/benchmark-title";
import { RunDatePicker } from "@/components/benchmarks/run-date-picker";

const VALID_PERCENTILES: PercentileType[] = ["median", "p90", "p95", "p99"];
const VALID_SORT: SortByType[] = ["latency", "reliability", "price"];

export const metadata: Metadata = {
  title: "Browser Lifecycle",
  description: "Compare browser session creation, connection, navigation, and release speed, reliability, and cost.",
  alternates: {
    canonical: "https://browserarena.ai",
  },
};

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{
    percentile?: string;
    sort?: string;
    concurrency?: string;
    date?: string;
  }>;
}) {
  return <Suspense fallback={<BenchmarkPending />}>
    <LifecycleContent searchParams={searchParams} />
  </Suspense>;
}

async function LifecycleContent({
  searchParams,
}: {
  searchParams: Promise<{ percentile?: string; sort?: string; concurrency?: string; date?: string }>;
}) {
  const params = await searchParams;
  return <LifecycleView
    date={/^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : ""}
    percentile={params.percentile ?? ""}
    sort={params.sort ?? ""}
    concurrency={params.concurrency ?? ""}
  />;
}

async function LifecycleView({
  date,
  percentile: requestedPercentileParam,
  sort: requestedSort,
  concurrency: requestedConcurrencyParam,
}: {
  date: string;
  percentile: string;
  sort: string;
  concurrency: string;
}) {
  "use cache: remote";
  cacheLife(BENCHMARK_CACHE_LIFE);
  const requestedDate = date || undefined;
  const requestedConcurrency = Number(requestedConcurrencyParam || 1);
  let effectiveConcurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 1;
  const requestedPercentile = (VALID_PERCENTILES.includes(requestedPercentileParam as PercentileType)
    ? requestedPercentileParam
    : "median") as PercentileType;
  let percentile = requestedPercentile;
  if (effectiveConcurrency > 1) percentile = "median";
  const sortBy = (VALID_SORT.includes(requestedSort as SortByType)
    ? requestedSort
    : "latency") as SortByType;

  let leaderboard = await loadLeaderboard(
    "hello-browser",
    requestedDate,
    percentile,
    sortBy,
    effectiveConcurrency
  );
  // The picker labels one calendar day. Load that day, not each provider's
  // newest file, so the rows match the date on screen.
  const knownDates = leaderboard.metadata.availableDates ?? [];
  const pinnedDate = requestedDate && knownDates.includes(requestedDate) ? requestedDate : knownDates.at(-1);
  if (pinnedDate && leaderboard.metadata.date !== pinnedDate) {
    leaderboard = await loadLeaderboard("hello-browser", pinnedDate, percentile, sortBy, effectiveConcurrency);
  }
  const concurrencyLevels = leaderboard.metadata.availableConcurrencyLevels?.length ? leaderboard.metadata.availableConcurrencyLevels : [1];
  if (!concurrencyLevels.includes(effectiveConcurrency)) {
    effectiveConcurrency = concurrencyLevels[0];
    percentile = effectiveConcurrency > 1 ? "median" : requestedPercentile;
    leaderboard = await loadLeaderboard("hello-browser", leaderboard.metadata.date ?? pinnedDate, percentile, sortBy, effectiveConcurrency);
  }
  const { providers } = leaderboard;
  const history = await loadHistoricalLeaderboard("hello-browser", effectiveConcurrency);
  const availableDates = leaderboard.metadata.availableDates ?? [];
  const selectedDate = leaderboard.metadata.date && availableDates.includes(leaderboard.metadata.date)
    ? leaderboard.metadata.date
    : availableDates.at(-1) ?? "";
  const lifecycleParams = new URLSearchParams({ percentile: requestedPercentile, sort: sortBy });
  if (leaderboard.metadata.date) lifecycleParams.set("date", leaderboard.metadata.date);
  const lifecycleQuery = lifecycleParams.toString();
  const dateQuery: Record<string, string> = { percentile: requestedPercentile, sort: sortBy };
  if (effectiveConcurrency !== 1) dateQuery.concurrency = String(effectiveConcurrency);

  return (
    <BenchmarkShell benchmark="hello-browser" concurrency={effectiveConcurrency} concurrencyLevels={concurrencyLevels} lifecycleQuery={lifecycleQuery}>
      <div id="leaderboard" className={`${styles.tableStage} scroll-mt-20`}>
        {providers.length > 0 ? (
          <div className="reveal-up">
            <LeaderboardTable
              data={providers}
              percentile={percentile}
              hideTitle
              controls={<BenchmarkTitle name={BENCHMARK_TITLES["hello-browser"]} date={<RunDatePicker dates={availableDates} selectedDate={selectedDate} benchmark="session-performance" pathname="/" query={dateQuery} />} />}
            />
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No results for this selection. Run the benchmark to generate data.
          </div>
        )}
      </div>
      <HistoryCharts
        history={history}
        percentile={percentile}
        selectedDate={selectedDate}
        initialProvider={providers[0]?.provider}
        animate={false}
        distributions={providers.map((provider) => ({
          provider: provider.provider,
          displayName: provider.displayName,
          sessionMs: provider.sessionMs,
        }))}
      />
    </BenchmarkShell>
  );
}
