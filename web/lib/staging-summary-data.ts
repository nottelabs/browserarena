import { loadHistoricalLeaderboard, loadLeaderboard, type ResultsSource } from "./data";
import type { HistoricalProviderPoint } from "./data-shared";
import { loadBrowserThroughputLeaderboard } from "./browser-throughput-data";
import { PROD_PROVIDER, STAGING_PROVIDER } from "./internal-staging";
import { DEFAULT_CONFIG, evaluateSeries } from "./regression";
import type { BaselineCheck, LifecycleNumbers, StagingSummaryInput, ThroughputNumbers } from "./staging-summary";

const CONCURRENCY = [1, 10];
const STAGING_DIR = "notte-staging";

export interface SummaryLoaders {
  loadLeaderboard: typeof loadLeaderboard;
  loadHistoricalLeaderboard: typeof loadHistoricalLeaderboard;
  loadBrowserThroughputLeaderboard: typeof loadBrowserThroughputLeaderboard;
  /** Status of a GitHub contents request, so a missing run (404) is not confused with a failed read. */
  contentsStatus: (source: ResultsSource, path: string) => Promise<number>;
}

const defaultLoaders: SummaryLoaders = {
  loadLeaderboard,
  loadHistoricalLeaderboard,
  loadBrowserThroughputLeaderboard,
  async contentsStatus(source, path) {
    const res = await fetch(`https://api.github.com/repos/${source.repo}/contents/${path}?ref=${source.branch}`, {
      headers: { Authorization: `Bearer ${source.token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    return res.status;
  },
};

/** Whether staging ran that day. Anything but found or not found is a read failure. */
async function stagingRanOn(source: ResultsSource, benchmark: string, date: string, loaders: SummaryLoaders): Promise<boolean> {
  const path = `results/${benchmark}/${STAGING_DIR}/${date}`;
  const status = await loaders.contentsStatus(source, path);
  if (status === 200) return true;
  if (status === 404) return false;
  throw new Error(`cannot read ${source.repo} ${path} (HTTP ${status}); check the token`);
}

/**
 * Staging against its own earlier runs, with the production regression
 * detector's rules (docs/regression-detection.md): a 28 run-day baseline that
 * ends before the last 3 runs, and a breach on 2 of those 3. Null when staging
 * has no run on `date`; the summary already reports that run as missed.
 */
export function stagingBaselineCheck(points: HistoricalProviderPoint[], date: string, concurrency: number): BaselineCheck | null {
  const history = points.filter((p) => p.date <= date);
  if (history.at(-1)?.date !== date) return null;
  // End of the run day: replaying a past day judges it as it was then.
  const health = evaluateSeries(
    history,
    { provider: STAGING_PROVIDER, displayName: "Notte staging", concurrency },
    new Date(`${date}T23:59:59.999Z`),
  );
  const total = health.metrics.find((m) => m.metric === "total");
  return {
    concurrency,
    status: health.status === "degraded" ? "degraded" : health.status === "ok" ? "ok" : "unknown",
    runDays: history.length,
    runDaysNeeded: DEFAULT_CONFIG.minBaselineDays + DEFAULT_CONFIG.recentDays,
    total: total ? { baseline: total.baseline, current: total.current } : null,
    breaches: health.breaches.map((b) => ({
      label: b.label,
      unit: b.unit,
      baseline: b.baseline,
      current: b.current,
      ratio: b.ratio,
      onsetDate: b.onsetDate,
    })),
  };
}

/**
 * Both targets on one day: staging's run that day and production's run that
 * day, never each provider's latest. Read failures throw; a run folder with no
 * samples (e.g. a crash before the first session) is reported as such.
 */
export async function loadStagingSummaryInput(
  date: string,
  source: ResultsSource,
  pageUrl: string,
  loaders: SummaryLoaders = defaultLoaders,
): Promise<StagingSummaryInput> {
  // README always exists: proves the token can read contents, not just metadata.
  const readme = await loaders.contentsStatus(source, "README.md");
  if (readme !== 200) throw new Error(`cannot read ${source.repo} contents (HTTP ${readme}); check the token`);

  const lifecycleRan = await stagingRanOn(source, "hello-browser", date, loaders);
  const lifecycle: StagingSummaryInput["lifecycle"] = [];
  const baseline: BaselineCheck[] = [];
  for (const concurrency of CONCURRENCY) {
    const [prod, staging, stagingHistory] = await Promise.all([
      loaders.loadLeaderboard("hello-browser", date, "median", "latency", concurrency),
      lifecycleRan ? loaders.loadLeaderboard("hello-browser", date, "median", "latency", concurrency, source) : null,
      // Strict: a failed read must not drop a day and change the verdict.
      lifecycleRan ? loaders.loadHistoricalLeaderboard("hello-browser", concurrency, source, { strict: true }) : null,
    ]);
    const series = stagingHistory?.providers.find((p) => p.provider === STAGING_PROVIDER);
    const check = series ? stagingBaselineCheck(series.points, date, concurrency) : null;
    if (check) baseline.push(check);
    // The day's leaderboard has staging but its history does not: never post without the check.
    const stagingRow = staging?.providers.find((r) => r.provider === STAGING_PROVIDER);
    if (stagingRow?.runDate === date && !check) {
      throw new Error(`staging c${concurrency} history has no ${date} run although that day's results loaded`);
    }
    const pick = (rows: typeof prod.providers, id: string): LifecycleNumbers | null => {
      const row = rows.find((r) => r.provider === id);
      return row ? { runDate: row.runDate, totalRuns: row.totalRuns, successRate: row.successRate, totalTimeMs: row.totalTimeMs, p90TotalMs: row.p90TotalMs } : null;
    };
    lifecycle.push({
      concurrency,
      prod: pick(prod.providers, PROD_PROVIDER),
      staging: staging ? pick(staging.providers, STAGING_PROVIDER) : null,
      stagingRan: lifecycleRan,
    });
  }

  const throughputRan = await stagingRanOn(source, "browser-throughput", date, loaders);
  const [prodThroughput, stagingThroughput] = await Promise.all([
    loaders.loadBrowserThroughputLeaderboard(1, date),
    throughputRan ? loaders.loadBrowserThroughputLeaderboard(1, date, source) : null,
  ]);
  const pickThroughput = (rows: typeof prodThroughput.providers, id: string): ThroughputNumbers | null => {
    const row = rows.find((r) => r.provider === id);
    return row
      ? { runDate: row.runDate, totalRuns: row.totalRuns, successRate: row.successRate, actionsPerSecond: row.actionsPerSecond.median, taskMs: row.taskMs.median }
      : null;
  };

  return {
    date,
    lifecycle,
    baseline,
    throughput: {
      prod: pickThroughput(prodThroughput.providers, PROD_PROVIDER),
      staging: stagingThroughput ? pickThroughput(stagingThroughput.providers, STAGING_PROVIDER) : null,
      stagingRan: throughputRan,
    },
    pageUrl,
  };
}
