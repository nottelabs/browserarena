import {
  loadLeaderboard,
  type PercentileType,
  type SortByType,
} from "@/lib/data";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { HelloBrowserControls } from "@/components/benchmark-controls";
import { PageShell, RunItYourself, TestEnvironment } from "@/components/page-shell";
import { Separator } from "@/components/ui/separator";

const VALID_PERCENTILES: PercentileType[] = ["median", "p90", "p95"];
const VALID_SORT: SortByType[] = ["latency", "reliability", "price"];

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

  if (minY === maxY && minM === maxM) return monthYearUtc(min);
  if (minY === maxY) {
    const a = min.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    const b = max.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return `${a} – ${b} ${minY}`;
  }
  return `${monthYearUtc(min)} – ${monthYearUtc(max)}`;
}

function formatRunsCaption(
  providers: { totalRuns: number }[],
  concurrencyParam?: number
): string | null {
  if (providers.length === 0) return null;
  const runs = providers.map((p) => p.totalRuns);
  const min = Math.min(...runs);
  const max = Math.max(...runs);
  if (min !== max) {
    return `${min.toLocaleString()}–${max.toLocaleString()} runs / provider`;
  }
  const c = concurrencyParam ?? 1;
  if (c > 0 && min % c === 0) {
    const perBrowser = min / c;
    if (c === 1) return `${min.toLocaleString()} sequential runs per provider`;
    return `${c.toLocaleString()} browsers in parallel, ${perBrowser.toLocaleString()} runs each per provider`;
  }
  return `${min.toLocaleString()} runs / provider`;
}

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

  const runsPerProvider = formatRunsCaption(providers, concurrency);
  const totalKey =
    percentile === "p95" ? "p95TotalMs" : percentile === "p90" ? "p90TotalMs" : "totalTimeMs";
  const winnerTotal =
    sortBy === "latency"
      ? (providers[0]?.[totalKey as keyof (typeof providers)[0]] as number | undefined)
      : undefined;
  const winnerReliability =
    sortBy === "reliability" ? providers[0]?.successRate : undefined;
  const winnerPrice =
    sortBy === "price" ? providers[0]?.pricePerHour : undefined;
  const percentileLabel =
    percentile === "median" ? "Median" : percentile.toUpperCase();

  const tagline =
    sortBy === "price"
      ? "Real benchmarks. Same test. Create, connect, navigate, release — who's cheapest?"
      : sortBy === "reliability"
        ? "Real benchmarks. Same test. Create, connect, navigate, release — who's most reliable?"
        : "Real benchmarks. Same test. Create, connect, navigate, release — who's fastest?";

  const dateDisplay = metadata.dateRange ? formatDateRange(metadata.dateRange) : null;
  const vmMetas = metadata.vmMetas ?? (metadata.vmMeta ? [metadata.vmMeta] : []);

  return (
    <PageShell
      tagline={tagline}
      controls={
        <HelloBrowserControls concurrencyLevels={metadata.availableConcurrencyLevels} />
      }
      caption={
        <div className="reveal-up reveal-up-delay-3 mt-3 flex items-center gap-3 text-[0.7rem] text-muted-foreground font-mono tabular-nums">
          {dateDisplay && <span>{dateDisplay}</span>}
          {dateDisplay && runsPerProvider && <span className="text-border">·</span>}
          {runsPerProvider && <span>{runsPerProvider}</span>}
        </div>
      }
    >
      {/* Winner callout */}
      {providers.length > 0 && (
        <div className="reveal-up reveal-up-delay-2 mb-8 flex flex-wrap items-baseline gap-3">
          <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium">
            {sortBy === "latency" ? "Fastest" : sortBy === "reliability" ? "Most reliable" : "Cheapest"}
          </span>
          <a href={providers[0].url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground hover:text-primary">
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

      {/* Leaderboard */}
      <div className="mb-12">
        {providers.length > 0 ? (
          <div className="section-surface section-surface-static reveal-up rounded-[1.75rem] p-5 sm:p-6">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium">Leaderboard</h2>
              <span className="text-[0.65rem] text-muted-foreground font-mono">All values in ms</span>
            </div>
            <LeaderboardTable data={providers} percentile={percentile} hideTitle />
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No results for this selection. Run the benchmark to generate data.
          </div>
        )}
      </div>

      <RunItYourself />

      {/* Methodology + Test Environment */}
      <Separator className="mb-6" />
      <section className="reveal-up reveal-up-delay-2 mb-10">
        <div className="flex flex-col sm:flex-row gap-8 sm:gap-16">
          <div className="flex-1">
            <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium mb-3">Methodology</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Each provider was tested with the same benchmark: create a browser session,
              connect via CDP, navigate to a blank page, and release. Tests ran from a single
              benchmark host to keep network conditions comparable. Results show {percentileLabel.toLowerCase()} values across all successful runs.
            </p>
          </div>
          <TestEnvironment vmMetas={vmMetas} />
        </div>
        <p className="mt-8 max-w-3xl text-[0.72rem] leading-relaxed text-muted-foreground border-t border-border/60 pt-4">
          <span className="font-medium text-foreground/90">Headless vs headful (headed).</span>{" "}
          Headless means the browser has no visible window (typical for automation and CI).
          Headful—often called headed—means a real display and rendering path, closer to a desktop browser.
        </p>
      </section>
    </PageShell>
  );
}
