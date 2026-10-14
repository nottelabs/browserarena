import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { loadBrowserThroughputHistory, loadBrowserThroughputLeaderboard } from "@/lib/browser-throughput-data";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { BrowserThroughputTable } from "@/components/browser-throughput-table";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import styles from "@/components/benchmarks/benchmark.module.css";
import { BENCHMARK_TITLES, BenchmarkTitle } from "@/components/benchmarks/benchmark-title";
import { RunDatePicker } from "@/components/benchmarks/run-date-picker";

export const metadata: Metadata = {
  title: "Browser Throughput",
  description:
    "Per-action throughput of cloud browser providers inside a running session: navigate, wait, screenshot, read, click, back. Actions per second, per-action percentiles, drift and cost per 1,000 actions.",
  alternates: {
    canonical: "https://browserarena.ai/throughput",
  },
};

export default function BrowserThroughputPage({
  searchParams,
}: {
  searchParams: Promise<{ concurrency?: string; date?: string }>;
}) {
  return <Suspense fallback={<BenchmarkPending />}>
    <ThroughputContent searchParams={searchParams} />
  </Suspense>;
}

async function ThroughputContent({ searchParams }: { searchParams: Promise<{ concurrency?: string; date?: string }> }) {
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : "";
  return <ThroughputView date={date} concurrency={params.concurrency ?? ""} />;
}

async function ThroughputView({ date, concurrency: requestedConcurrency }: { date: string; concurrency: string }) {
  "use cache: remote";
  cacheLife(BENCHMARK_CACHE_LIFE);
  const requestedDate = date || undefined;
  const requested = Number(requestedConcurrency || 1);
  let concurrency = Number.isInteger(requested) && requested > 0 ? requested : 1;
  let leaderboard = await loadBrowserThroughputLeaderboard(concurrency, requestedDate);
  // The picker labels one calendar day. Load that day, not each provider's
  // newest file, so the rows match the date on screen.
  const knownDates = leaderboard.metadata.availableDates ?? [];
  const pinnedDate = requestedDate && knownDates.includes(requestedDate) ? requestedDate : knownDates.at(-1);
  if (pinnedDate && leaderboard.metadata.date !== pinnedDate) {
    leaderboard = await loadBrowserThroughputLeaderboard(concurrency, pinnedDate);
  }
  const concurrencyLevels = leaderboard.metadata.availableConcurrencyLevels?.length
    ? leaderboard.metadata.availableConcurrencyLevels
    : [1];
  if (!concurrencyLevels.includes(concurrency)) {
    concurrency = concurrencyLevels[0];
    leaderboard = await loadBrowserThroughputLeaderboard(concurrency, leaderboard.metadata.date ?? pinnedDate);
  }
  const { providers } = leaderboard;
  const availableDates = leaderboard.metadata.availableDates ?? [];
  const selectedDate = leaderboard.metadata.date && availableDates.includes(leaderboard.metadata.date)
    ? leaderboard.metadata.date
    : availableDates.at(-1) ?? "";
  const dateQuery: Record<string, string> = {};
  if (concurrency !== 1) dateQuery.concurrency = String(concurrency);
  const history = await loadBrowserThroughputHistory(concurrency);

  return (
    <BenchmarkShell benchmark="browser-throughput" concurrency={concurrency} concurrencyLevels={concurrencyLevels} date={leaderboard.metadata.date}>
      <div id="leaderboard" className={`${styles.tableStage} scroll-mt-20`}>
        {providers.length > 0 ? (
          <div className="reveal-up">
            <BrowserThroughputTable
              data={providers}
              history={history}
              controls={<BenchmarkTitle name={BENCHMARK_TITLES["browser-throughput"]} date={<RunDatePicker dates={availableDates} selectedDate={selectedDate} benchmark="browser-throughput" pathname="/throughput" query={dateQuery} />} />}
            />
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No browser-throughput results yet. Run{" "}
            <code className="font-mono">npm run bench -- --benchmark=browser-throughput</code> to generate data.
          </div>
        )}
      </div>
    </BenchmarkShell>
  );
}
