import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { loadPublishedBrowserThroughput } from "@/lib/browser-throughput-data";
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
  let published = await loadPublishedBrowserThroughput(concurrency, requestedDate);
  const concurrencyLevels = published.leaderboard.metadata.availableConcurrencyLevels?.length
    ? published.leaderboard.metadata.availableConcurrencyLevels
    : [1];
  if (!concurrencyLevels.includes(concurrency)) {
    concurrency = concurrencyLevels[0];
    published = await loadPublishedBrowserThroughput(concurrency, requestedDate);
  }
  const { leaderboard, history, publication } = published;
  const { providers } = leaderboard;
  const availableDates = publication.dates;
  const selectedDate = publication.selectedDate ?? "";
  const selectedCoverage = publication.coverage.find((day) => day.date === selectedDate);
  const newerResultsPending = selectedDate === publication.latestCompleteDate && selectedDate !== availableDates.at(-1);
  const partialDates = publication.coverage.filter((day) => !day.complete).map((day) => day.date);
  const dateQuery: Record<string, string> = {};
  if (concurrency !== 1) dateQuery.concurrency = String(concurrency);

  return (
    <BenchmarkShell benchmark="browser-throughput" concurrency={concurrency} concurrencyLevels={concurrencyLevels} date={leaderboard.metadata.date}>
      <div id="leaderboard" className={`${styles.tableStage} scroll-mt-20`}>
        {providers.length > 0 ? (
          <div className="reveal-up">
            {selectedCoverage && !selectedCoverage.complete ? (
              <p className="mb-4 text-sm text-muted-foreground" role="status">
                Partial results: {selectedCoverage.reported} of {selectedCoverage.expected} providers have reported for this date.
              </p>
            ) : newerResultsPending ? (
              <p className="mb-4 text-sm text-muted-foreground" role="status">
                Showing the latest complete day. Newer results are partial and available in the date picker.
              </p>
            ) : null}
            <BrowserThroughputTable
              data={providers}
              history={history}
              controls={<BenchmarkTitle name={BENCHMARK_TITLES["browser-throughput"]} date={<RunDatePicker dates={availableDates} selectedDate={selectedDate} partialDates={partialDates} benchmark="browser-throughput" pathname="/throughput" query={dateQuery} />} />}
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
