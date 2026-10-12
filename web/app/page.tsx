import type { Metadata } from "next";
import {
  loadHistoricalLeaderboard,
  loadLeaderboard,
  type PercentileType,
  type SortByType,
} from "@/lib/data";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { HistoryCharts } from "@/components/history-charts";
import styles from "@/components/benchmarks/benchmark.module.css";

const VALID_PERCENTILES: PercentileType[] = ["median", "p90", "p95", "p99"];
const VALID_SORT: SortByType[] = ["latency", "reliability", "price"];

export const metadata: Metadata = {
  title: "Session Performance",
  description: "Compare browser session creation, connection, navigation, and release speed, reliability, and cost.",
  alternates: {
    canonical: "https://browserarena.ai",
  },
};


export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    percentile?: string;
    sort?: string;
    concurrency?: string;
  }>;
}) {
  const params = await searchParams;
  const requestedConcurrency = Number(params.concurrency ?? 1);
  let effectiveConcurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 1;
  const requestedPercentile = (VALID_PERCENTILES.includes(params.percentile as PercentileType)
    ? params.percentile
    : "median") as PercentileType;
  let percentile = requestedPercentile;
  if (effectiveConcurrency > 1) percentile = "median";
  const sortBy = (VALID_SORT.includes(params.sort as SortByType)
    ? params.sort
    : "latency") as SortByType;

  let leaderboard = await loadLeaderboard(
    "hello-browser",
    undefined,
    percentile,
    sortBy,
    effectiveConcurrency
  );
  const concurrencyLevels = leaderboard.metadata.availableConcurrencyLevels?.length ? leaderboard.metadata.availableConcurrencyLevels : [1];
  if (!concurrencyLevels.includes(effectiveConcurrency)) {
    effectiveConcurrency = concurrencyLevels[0];
    percentile = effectiveConcurrency > 1 ? "median" : requestedPercentile;
    leaderboard = await loadLeaderboard("hello-browser", undefined, percentile, sortBy, effectiveConcurrency);
  }
  const { providers } = leaderboard;
  const history = await loadHistoricalLeaderboard("hello-browser", effectiveConcurrency);
  const lifecycleQuery = new URLSearchParams({ percentile: requestedPercentile, sort: sortBy }).toString();


  return (
    <BenchmarkShell benchmark="hello-browser" concurrency={effectiveConcurrency} concurrencyLevels={concurrencyLevels} lifecycleQuery={lifecycleQuery}>

      {/* Leaderboard */}
      <div id="leaderboard" className={`${styles.tableStage} scroll-mt-20`}>
        {providers.length > 0 ? (
          <div className="reveal-up">
            <LeaderboardTable
              data={providers}
              percentile={percentile}
              hideTitle
              controls={<div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Benchmark</h2>
                <p className="mt-1 text-[0.72rem] text-muted-foreground">Session Performance · {effectiveConcurrency === 1 ? "Sequential runs" : `Concurrent runs · c = ${effectiveConcurrency}`} · {percentile === "median" ? "Median" : percentile.toUpperCase()} latency</p>
              </div>}
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
        initialProvider={providers[0]?.provider}
        animate={false}
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">
          We&apos;re open-source and reproducible!<span className="hidden sm:inline"> Contribute.</span>{' '}
          Built by{' '}
          <a href="https://notte.cc" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">Notte</a>.
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href="https://railway.com/deploy/UNedGj?referralCode=YUwE3Q&utm_medium=integration&utm_source=template&utm_campaign=generic"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[3px] border-[1.5px] border-foreground px-4 py-2 text-[0.78rem] font-medium text-foreground hover:bg-foreground hover:text-background transition-colors"
          >
            Reproduce Now
          </a>
          <a
            href="https://github.com/nottelabs/browserarena"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[3px] border-[1.5px] border-foreground px-4 py-2 text-[0.78rem] font-medium text-foreground hover:bg-foreground hover:text-background transition-colors"
          >
            + Add a Provider
          </a>
          <a
            href="https://github.com/nottelabs/browserarena"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex rounded-[3px] border-[1.5px] border-foreground px-4 py-2 text-[0.78rem] font-medium text-foreground hover:bg-foreground hover:text-background transition-colors"
          >
            + Add a Bench
          </a>
        </div>
      </div>

    </BenchmarkShell>
  );
}
