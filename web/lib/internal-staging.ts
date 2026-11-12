import {
  loadHistoricalLeaderboard,
  loadLeaderboard,
  type HistoricalLeaderboardResult,
  type ProviderStats,
  type ResultsSource,
} from "./data";
import { loadBrowserThroughputHistory, loadBrowserThroughputLeaderboard } from "./browser-throughput-data";
import type { BrowserThroughputProviderStats, ThroughputHistory } from "./browser-throughput-shared";
import { PROVIDERS_BY_ID } from "./providers";

/**
 * Team-only comparison of Notte production with Notte staging
 * (us-staging.notte.cc). Production comes from the public results; staging
 * from the private nottelabs/browserarena-staging-results repo, read with a
 * read-only token. Nothing here is linked from or rendered on public pages.
 */

export const PROD_PROVIDER = "NOTTE";
export const STAGING_PROVIDER = "NOTTE_STAGING";
const LABELS: Record<string, string> = {
  [PROD_PROVIDER]: "Notte production",
  [STAGING_PROVIDER]: "Notte staging",
};

export function stagingResultsSource(): ResultsSource | null {
  const token = process.env.INTERNAL_RESULTS_GITHUB_TOKEN;
  if (!token) return null;
  return {
    repo: process.env.INTERNAL_RESULTS_GITHUB_REPO || "nottelabs/browserarena-staging-results",
    branch: process.env.INTERNAL_RESULTS_GITHUB_BRANCH || "main",
    token,
  };
}

function relabel<T extends { provider: string; displayName: string }>(rows: T[]): T[] {
  return rows
    .filter((row) => row.provider in LABELS)
    .map((row) => ({ ...row, displayName: LABELS[row.provider]!, ...("url" in row ? { url: PROVIDERS_BY_ID.NOTTE!.url } : {}) }));
}

/** Production first, then staging, so the two rows always sit in the same order. */
function byTarget<T extends { provider: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(a.provider === STAGING_PROVIDER) - Number(b.provider === STAGING_PROVIDER));
}

/** Rows come from two separate leaderboards, so each arrives ranked first. */
function numbered<T extends { rank: number }>(rows: T[]): T[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function mergeHistory(prod: HistoricalLeaderboardResult, staging: HistoricalLeaderboardResult | null): HistoricalLeaderboardResult {
  const providers = byTarget(relabel([...prod.providers, ...(staging?.providers ?? [])]));
  const dates = [...new Set(providers.flatMap((series) => series.points.map((point) => point.date)))].sort();
  return { dates, providers };
}

function mergeThroughputHistory(prod: ThroughputHistory, staging: ThroughputHistory | null): ThroughputHistory {
  const providers = byTarget(relabel([...prod.providers, ...(staging?.providers ?? [])]));
  const dates = [...new Set(providers.flatMap((series) => series.points.map((point) => point.date)))].sort();
  return { dates, providers };
}

export interface StagingComparison {
  /** False when the read token is not configured, so staging cannot load. */
  stagingConfigured: boolean;
  concurrency: number;
  concurrencyLevels: number[];
  lifecycle: ProviderStats[];
  lifecycleHistory: HistoricalLeaderboardResult;
  throughput: BrowserThroughputProviderStats[];
  throughputHistory: ThroughputHistory;
}

export async function loadStagingComparison(requestedConcurrency: number): Promise<StagingComparison> {
  const source = stagingResultsSource();
  const levelsOf = async (concurrency: number) => {
    const [prod, staging] = await Promise.all([
      loadLeaderboard("hello-browser", undefined, "median", "latency", concurrency),
      source ? loadLeaderboard("hello-browser", undefined, "median", "latency", concurrency, source) : null,
    ]);
    return { prod, staging };
  };
  let concurrency = requestedConcurrency;
  let lifecycle = await levelsOf(concurrency);
  const concurrencyLevels = [...new Set([
    ...(lifecycle.staging?.metadata.availableConcurrencyLevels ?? []),
    ...(lifecycle.prod.metadata.availableConcurrencyLevels ?? []),
  ])].sort((a, b) => a - b);
  if (concurrencyLevels.length && !concurrencyLevels.includes(concurrency)) {
    concurrency = concurrencyLevels[0]!;
    lifecycle = await levelsOf(concurrency);
  }

  // The scheduled throughput runs are sequential only.
  const [prodHistory, stagingHistory, prodThroughput, stagingThroughput, prodThroughputHistory, stagingThroughputHistory] = await Promise.all([
    loadHistoricalLeaderboard("hello-browser", concurrency),
    source ? loadHistoricalLeaderboard("hello-browser", concurrency, source) : null,
    loadBrowserThroughputLeaderboard(1),
    source ? loadBrowserThroughputLeaderboard(1, undefined, source) : null,
    loadBrowserThroughputHistory(1),
    source ? loadBrowserThroughputHistory(1, source) : null,
  ]);

  return {
    stagingConfigured: source !== null,
    concurrency,
    concurrencyLevels: concurrencyLevels.length ? concurrencyLevels : [1],
    lifecycle: numbered(byTarget(relabel([...lifecycle.prod.providers, ...(lifecycle.staging?.providers ?? [])]))),
    lifecycleHistory: mergeHistory(prodHistory, stagingHistory),
    throughput: numbered(byTarget(relabel([...prodThroughput.providers, ...(stagingThroughput?.providers ?? [])]))),
    throughputHistory: mergeThroughputHistory(prodThroughputHistory, stagingThroughputHistory),
  };
}
