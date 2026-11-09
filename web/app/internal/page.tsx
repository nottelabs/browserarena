import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { historyChartData } from "@/lib/history-chart-data";
import { internalSecret, INTERNAL_SESSION_COOKIE, verifySession } from "@/lib/internal-auth";
import { loadStagingComparison, STAGING_PROVIDER } from "@/lib/internal-staging";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { HistoryCharts } from "@/components/history-charts";
import { BrowserThroughputTable } from "@/components/browser-throughput-table";
import styles from "@/components/benchmarks/benchmark.module.css";

export const metadata: Metadata = {
  // Neutral on purpose: metadata is in the static shell.
  title: "Internal",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function InternalPage({ searchParams }: { searchParams: Promise<{ concurrency?: string }> }) {
  return <Suspense fallback={null}><InternalContent searchParams={searchParams} /></Suspense>;
}

async function InternalContent({ searchParams }: { searchParams: Promise<{ concurrency?: string }> }) {
  // Without a session from the console's link, this page does not exist.
  const secret = internalSecret();
  const session = (await cookies()).get(INTERNAL_SESSION_COOKIE)?.value;
  if (!secret || !verifySession(session, secret)) notFound();

  const requested = Number((await searchParams).concurrency ?? 1);
  return <InternalView concurrency={Number.isInteger(requested) && requested > 0 ? requested : 1} />;
}

/** Called only after the session check above. */
async function loadComparison(concurrency: number) {
  "use cache: remote";
  cacheLife(BENCHMARK_CACHE_LIFE);
  return loadStagingComparison(concurrency);
}

async function InternalView({ concurrency: requested }: { concurrency: number }) {
  const data = await loadComparison(requested);
  const { concurrency } = data;
  const latestDate = data.lifecycleHistory.dates.at(-1) ?? "";

  return (
    <main className={`${styles.container} mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 pb-10`}>
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Team only</p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight">Notte staging vs production</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The daily BrowserArena run, with the same settings and the same us-west-1 runner, against{" "}
          <code className="font-mono">us-staging.notte.cc</code>. Staging runs at 20:00 UTC, about eight hours
          before the 04:00 UTC production run, so a staging day D comes before production day D+1.
        </p>
        {!data.stagingConfigured && (
          <p className="mt-3 text-sm text-destructive" role="status">
            Staging results are not configured: INTERNAL_RESULTS_GITHUB_TOKEN is missing. Showing production only.
          </p>
        )}
      </header>

      <section aria-labelledby="lifecycle" className="mb-14">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="lifecycle" className="text-lg font-semibold tracking-tight">Browser Lifecycle</h2>
          <nav aria-label="Concurrency" className="flex gap-2 text-sm">
            {data.concurrencyLevels.map((level) => (
              <Link
                key={level}
                href={level === 1 ? "/internal" : `/internal?concurrency=${level}`}
                aria-current={level === concurrency ? "page" : undefined}
                className={`rounded-[3px] border px-2 py-0.5 ${level === concurrency ? "border-foreground font-medium" : "border-foreground/25 text-muted-foreground"}`}
              >
                c{level}
              </Link>
            ))}
          </nav>
        </div>
        {data.lifecycle.length > 0 ? (
          <LeaderboardTable data={data.lifecycle} percentile="median" hideTitle />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">No lifecycle results at c{concurrency} yet.</p>
        )}
        <div className="mt-8">
          <HistoryCharts
            history={historyChartData(data.lifecycleHistory, "median", latestDate)}
            percentile="median"
            selectedDate={latestDate}
            initialProvider={STAGING_PROVIDER}
            animate={false}
            distributions={data.lifecycle.map((provider) => ({
              provider: provider.provider,
              displayName: provider.displayName,
              sessionMs: provider.sessionMs,
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="throughput">
        <h2 id="throughput" className="mb-4 text-lg font-semibold tracking-tight">Browser Throughput (sequential)</h2>
        {data.throughput.length > 0 ? (
          <BrowserThroughputTable data={data.throughput} history={data.throughputHistory} />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">No throughput results yet.</p>
        )}
      </section>
    </main>
  );
}
