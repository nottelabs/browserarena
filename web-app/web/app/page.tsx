import { Suspense } from "react";
import {
  loadLeaderboard,
  listBenchmarkDates,
  type PercentileType,
  type SortByType,
} from "@/lib/data";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { StackedBarChart } from "@/components/stacked-bar-chart";
import { HeartbeatMonitor } from "@/components/hero-animation";
import Link from "next/link";
import { BenchmarkControls, GitHubLink } from "@/components/benchmark-controls";
import { Logo } from "@/components/logo";
import {
  Header,
  HeaderContent,
  HeaderTitle,
  HeaderDescription,
  HeaderActions,
} from "@/components/ui/header";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import { Separator } from "@/components/ui/separator";

const VALID_PERCENTILES: PercentileType[] = ["median", "p90", "p95"];
const VALID_SORT: SortByType[] = ["latency", "reliability", "price"];

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRange(range: { min: string; max: string }): string {
  const min = new Date(range.min);
  const max = new Date(range.max);
  const minY = min.getUTCFullYear();
  const minM = min.getUTCMonth();
  const maxY = max.getUTCFullYear();
  const maxM = max.getUTCMonth();

  const monthYearUtc = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  if (minY === maxY && minM === maxM) {
    return monthYearUtc(min);
  }
  if (minY === maxY) {
    const a = min.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    const b = max.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return `${a} – ${b} ${minY}`;
  }
  return `${monthYearUtc(min)} – ${monthYearUtc(max)}`;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    benchmark?: string;
    date?: string;
    percentile?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const benchmark = (params.benchmark || "hello-browser") as "hello-browser" | "v0";
  const date = params.date || undefined;
  const percentile = (VALID_PERCENTILES.includes(
    params.percentile as PercentileType
  )
    ? params.percentile
    : "median") as PercentileType;
  const sortBy = (VALID_SORT.includes(params.sort as SortByType)
    ? params.sort
    : "latency") as SortByType;

  const v0Dates = await listBenchmarkDates("v0");
  const { providers, metadata } = await loadLeaderboard(
    benchmark,
    date,
    percentile,
    sortBy
  );

  const runsPerProvider =
    providers.length > 0
      ? (() => {
        const runs = providers.map((p) => p.totalRuns);
        const min = Math.min(...runs);
        const max = Math.max(...runs);
        return min === max
          ? `${min.toLocaleString()} runs / provider`
          : `${min.toLocaleString()}–${max.toLocaleString()} runs / provider`;
      })()
      : null;
  const totalKey =
    percentile === "p95"
      ? "p95TotalMs"
      : percentile === "p90"
        ? "p90TotalMs"
        : "totalTimeMs";
  const winnerTotal =
    sortBy === "latency"
      ? (providers[0]?.[totalKey as keyof (typeof providers)[0]] as
        | number
        | undefined)
      : undefined;
  const winnerReliability =
    sortBy === "reliability"
      ? (providers[0]?.successRate as number | undefined)
      : undefined;
  const winnerPrice =
    sortBy === "price"
      ? (providers[0]?.pricePerHour as number | undefined)
      : undefined;
  const percentileLabel =
    percentile === "median" ? "Median" : percentile.toUpperCase();

  const tagline =
    sortBy === "price"
      ? "Real benchmarks. Same test. Create, connect, navigate, release — who's cheapest?"
      : sortBy === "reliability"
        ? "Real benchmarks. Same test. Create, connect, navigate, release — who's most reliable?"
        : "Real benchmarks. Same test. Create, connect, navigate, release — who's fastest?";

  const dateDisplay =
    benchmark === "v0" && metadata.date
      ? formatDate(metadata.date)
      : metadata.dateRange
        ? formatDateRange(metadata.dateRange)
        : null;

  return (
    <div className="page-ambient min-h-screen flex flex-col">
      <NavBar>
        <NavBarContent>
          <NavBarBrand>
            <Link href="/" className="hover:opacity-80">
              <Logo size="sm" />
            </Link>
          </NavBarBrand>
          <NavBarActions>
            <GitHubLink />
          </NavBarActions>
        </NavBarContent>
      </NavBar>

      <Header>
        <HeaderContent className="reveal-fade">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <HeaderTitle className="reveal-up">Where cloud browsers compete</HeaderTitle>
              <HeaderDescription className="reveal-up reveal-up-delay-1">
                {tagline}
              </HeaderDescription>
              <HeaderActions className="reveal-up reveal-up-delay-2">
                <Suspense fallback={<div className="h-9" />}>
                  <BenchmarkControls v0Dates={v0Dates} />
                  <div className="reveal-up reveal-up-delay-3 mt-3 flex items-center gap-3 text-[0.7rem] text-muted-foreground font-mono tabular-nums">
                    {dateDisplay && <span>{dateDisplay}</span>}
                    {dateDisplay && runsPerProvider && (
                      <span className="text-border">·</span>
                    )}
                    {runsPerProvider && <span>{runsPerProvider}</span>}
                  </div>
                </Suspense>
              </HeaderActions>
            </div>
            <div className="hidden lg:block shrink-0 reveal-up reveal-up-delay-2 -mr-4">
              <HeartbeatMonitor className="w-[380px] h-[270px]" />
            </div>
          </div>
        </HeaderContent>
      </Header>

      {/* Main content */}
      <main className="flex-1 mx-auto max-w-6xl w-full px-6 sm:px-10 pt-4 pb-10">
        {/* Winner callout */}
        {providers.length > 0 && (
          <div className="reveal-up reveal-up-delay-2 mb-8 flex flex-wrap items-baseline gap-3">
            <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium">
              {sortBy === "latency"
                ? "Fastest"
                : sortBy === "reliability"
                  ? "Most reliable"
                  : sortBy === "price"
                    ? "Cheapest"
                    : "Top"}
            </span>
            <a
              href={providers[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground hover:text-primary"
            >
              {providers[0].displayName}
            </a>
            {winnerTotal != null && (
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {Math.round(winnerTotal).toLocaleString()}ms total
              </span>
            )}
            {winnerReliability != null && (
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {winnerReliability.toFixed(1)}%
              </span>
            )}
            {winnerPrice != null && (
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                ${winnerPrice.toFixed(2)}/hr
              </span>
            )}
          </div>
        )}

        {/* Data */}
        <div className="mb-12">
          {providers.length > 0 ? (
            <div className="flex flex-col gap-10">
              <div className="section-surface section-surface-static reveal-up rounded-[1.75rem] p-5 sm:p-6">
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium">
                    Leaderboard
                  </h2>
                  <span className="text-[0.65rem] text-muted-foreground font-mono">
                    All values in ms
                  </span>
                </div>
                <LeaderboardTable
                  data={providers}
                  percentile={percentile}
                  hideTitle
                />
              </div>
              <div className="section-surface section-surface-static reveal-up reveal-up-delay-1 rounded-[1.75rem] p-5 sm:p-6">
                <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium mb-4">
                  Total latency breakdown
                </h2>
                <div className="relative h-[260px] w-full min-w-0">
                  <div className="absolute inset-0">
                    <StackedBarChart data={providers} percentile={percentile} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No results for this selection. Run the benchmark to generate data.
            </div>
          )}
        </div>

        {/* Methodology + Test Environment */}
        <Separator className="mb-6" />
        <section className="reveal-up reveal-up-delay-2 mb-10">
          <div className="flex flex-col sm:flex-row gap-8 sm:gap-16">
            <div className="flex-1">
              <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium mb-3">
                Methodology
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                Each provider was tested with the same benchmark: create a browser session,
                connect via CDP, navigate to a blank page, and release. Tests ran from the same
                region to minimize network variance. Results show {percentileLabel.toLowerCase()} values across all successful runs.
              </p>
            </div>
            {metadata.vmMeta && (
              <div className="shrink-0">
                <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium mb-3">
                  Test Environment
                </h2>
                <div className="flex flex-col gap-1 text-[0.72rem] font-mono text-muted-foreground">
                  {metadata.vmMeta.cloud && metadata.vmMeta.region && (
                    <span>{metadata.vmMeta.cloud.toUpperCase()} {metadata.vmMeta.region}</span>
                  )}
                  {(metadata.vmMeta.instance_type || metadata.vmMeta.os) && (
                    <span>
                      {[metadata.vmMeta.instance_type, metadata.vmMeta.os].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {metadata.vmMeta.node_version && (
                    <span>Node {metadata.vmMeta.node_version}</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="mt-8 max-w-3xl text-[0.72rem] leading-relaxed text-muted-foreground border-t border-border/60 pt-4">
            <span className="font-medium text-foreground/90">Headless vs headful (headed).</span>{" "}
            Headless means the browser has no visible window (typical for automation and CI).
            Headful—often called headed—means a real display and rendering path, closer to a desktop
            browser. Latency and cost are not directly comparable between the two.
          </p>
        </section>
      </main>

    </div>
  );
}
