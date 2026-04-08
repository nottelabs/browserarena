import { Suspense } from "react";
import type { Metadata } from "next";
import {
  loadLeaderboard,
  type PercentileType,
  type SortByType,
} from "@/lib/data";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { HelloBrowserControls } from "@/components/benchmark-controls";
import { PageShell } from "@/components/page-shell";

const VALID_PERCENTILES: PercentileType[] = ["median", "p90", "p95"];
const VALID_SORT: SortByType[] = ["latency", "reliability", "price"];

export const metadata: Metadata = {
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
  const concurrency = params.concurrency ? Number(params.concurrency) : undefined;
  const effectiveConcurrency = concurrency ?? 1;
  let percentile = (VALID_PERCENTILES.includes(params.percentile as PercentileType)
    ? params.percentile
    : "median") as PercentileType;
  if (effectiveConcurrency > 1) percentile = "median";
  const sortBy = (VALID_SORT.includes(params.sort as SortByType)
    ? params.sort
    : "latency") as SortByType;

  const { providers, metadata } = await loadLeaderboard(
    "hello-browser",
    undefined,
    percentile,
    sortBy,
    concurrency
  );


  return (
    <PageShell>

      {/* Leaderboard */}
      <div id="leaderboard" className="mb-5 sm:mb-12 scroll-mt-20">
        {providers.length > 0 ? (
          <div className="reveal-up">
            <LeaderboardTable
              data={providers}
              percentile={percentile}
              hideTitle
              controls={
                <Suspense fallback={<div className="h-9" />}>
                  <HelloBrowserControls concurrencyLevels={metadata.availableConcurrencyLevels} />
                </Suspense>
              }
            />
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No results for this selection. Run the benchmark to generate data.
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">
          We&apos;re open-source and reproducible!<span className="hidden sm:inline"> Contribute.</span>
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

    </PageShell>
  );
}
