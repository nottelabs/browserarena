import { loadLeaderboard, type ResultsSource } from "./data";
import { loadBrowserThroughputLeaderboard } from "./browser-throughput-data";
import { PROD_PROVIDER, STAGING_PROVIDER } from "./internal-staging";
import type { LifecycleNumbers, StagingSummaryInput, ThroughputNumbers } from "./staging-summary";

const CONCURRENCY = [1, 10];
const STAGING_DIR = "notte-staging";

export interface SummaryLoaders {
  loadLeaderboard: typeof loadLeaderboard;
  loadBrowserThroughputLeaderboard: typeof loadBrowserThroughputLeaderboard;
  /** Status of a GitHub contents request, so a missing run (404) is not confused with a failed read. */
  contentsStatus: (source: ResultsSource, path: string) => Promise<number>;
}

const defaultLoaders: SummaryLoaders = {
  loadLeaderboard,
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
  for (const concurrency of CONCURRENCY) {
    const [prod, staging] = await Promise.all([
      loaders.loadLeaderboard("hello-browser", date, "median", "latency", concurrency),
      lifecycleRan ? loaders.loadLeaderboard("hello-browser", date, "median", "latency", concurrency, source) : null,
    ]);
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
    throughput: {
      prod: pickThroughput(prodThroughput.providers, PROD_PROVIDER),
      staging: stagingThroughput ? pickThroughput(stagingThroughput.providers, STAGING_PROVIDER) : null,
      stagingRan: throughputRan,
    },
    pageUrl,
  };
}
