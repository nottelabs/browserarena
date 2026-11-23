/**
 * Loads `results/browser-throughput/<provider>/<date>/c<N>/results.jsonl` from disk,
 * from GitHub at the deployed commit when a deployed function does not bundle
 * them (lib/results-store.ts), or from GitHub's API when neither is available,
 * and builds the browser-throughput leaderboard. Latest run date per provider,
 * like hello-browser.
 */

import { fetchFromGitHub, getResultsDir, listFromGitHub, PUBLIC_RESULTS_SOURCE, type ResultsSource } from "./data";
import { resultsStoreFor, type ResultsStore } from "./results-store";
import { calendarDates } from "./history-range";
import { HIDDEN_PROVIDER_IDS, PROVIDERS_BY_ID } from "./providers";
import { getPricePerHour, getUnitPricing } from "./pricing";
import { throughputPublication } from "./throughput-publication";
import {
  rankBrowserThroughput,
  summarizeBrowserThroughput,
  type BrowserThroughputEntry,
  type BrowserThroughputLeaderboardResult,
  type ThroughputHistory,
  type ThroughputHistoryPoint,
  type Triple,
} from "./browser-throughput-shared";

const BENCHMARK = "browser-throughput";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONC_RE = /^c\d+$/;

function parseLines(content: string, runDate: string): BrowserThroughputEntry[] {
  const entries: BrowserThroughputEntry[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line) continue;
    try {
      const raw = JSON.parse(line) as BrowserThroughputEntry;
      if (!Array.isArray(raw.actions)) raw.actions = [];
      raw._runDate = runDate;
      entries.push(raw);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function loadFromStore(store: ResultsStore, date?: string): Promise<{ entries: BrowserThroughputEntry[]; dates: string[] }> {
  const availableDates = new Set<string>();

  const providerDirs = (await store.list(BENCHMARK))
    .filter((e) => e.isDirectory && !e.name.startsWith("_"));

  // Read providers in parallel, then merge in directory order.
  const perProvider = await Promise.all(providerDirs.map(async (dir) => {
    const providerPath = `${BENCHMARK}/${dir.name}`;
    const dateDirs = (await store.list(providerPath))
      .filter((e) => e.isDirectory && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    const latestDate = date && dateDirs.includes(date) ? date : date ? undefined : dateDirs[0];
    if (!latestDate) return { dateDirs, entries: [] };

    const runDir = `${providerPath}/${latestDate}`;
    const concDirs = (await store.list(runDir))
      .filter((e) => e.isDirectory && CONC_RE.test(e.name))
      .map((e) => e.name);
    const contents = await Promise.all(concDirs.map((concDir) => store.read(`${runDir}/${concDir}/results.jsonl`)));
    return { dateDirs, entries: contents.flatMap((content) => content == null ? [] : parseLines(content, latestDate)) };
  }));

  const entries: BrowserThroughputEntry[] = [];
  for (const provider of perProvider) {
    for (const name of provider.dateDirs) availableDates.add(name);
    entries.push(...provider.entries);
  }
  return { entries, dates: [...availableDates].sort() };
}

async function loadFromGitHub(date?: string, source: ResultsSource = PUBLIC_RESULTS_SOURCE): Promise<{ entries: BrowserThroughputEntry[]; dates: string[] }> {
  const basePath = `results/${BENCHMARK}`;
  const entries: BrowserThroughputEntry[] = [];
  const availableDates = new Set<string>();
  const providerDirs = (await listFromGitHub(basePath, source)).filter(
    (e) => e.type === "dir" && !e.name.startsWith("_")
  );

  for (const dir of providerDirs) {
    const dates = (await listFromGitHub(`${basePath}/${dir.name}`, source))
      .filter((e) => e.type === "dir" && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const name of dates) availableDates.add(name);
    const latestDate = date && dates.includes(date) ? date : date ? undefined : dates[0];
    if (!latestDate) continue;

    const concDirs = (await listFromGitHub(`${basePath}/${dir.name}/${latestDate}`, source))
      .filter((e) => e.type === "dir" && CONC_RE.test(e.name))
      .map((e) => e.name);
    for (const concDir of concDirs) {
      try {
        const content = await fetchFromGitHub(`${basePath}/${dir.name}/${latestDate}/${concDir}/results.jsonl`, source);
        entries.push(...parseLines(content, latestDate));
      } catch {
        // skip
      }
    }
  }
  return { entries, dates: [...availableDates].sort() };
}

export async function loadBrowserThroughputLeaderboard(
  concurrency?: number,
  date?: string,
  /** Reads this repository instead of the bundled or public results. */
  source?: ResultsSource
): Promise<BrowserThroughputLeaderboardResult> {
  const store = source ? null : resultsStoreFor(BENCHMARK, getResultsDir());
  const loaded = source
    ? await loadFromGitHub(date, source)
    : store ? await loadFromStore(store, date) : await loadFromGitHub(date);
  const allEntries = loaded.entries;

  const measured = allEntries.filter(
    (e) => e.warmup !== true && !HIDDEN_PROVIDER_IDS.has(e.provider)
  );

  const levels = [...new Set(measured.map((e) => e.concurrency ?? 1))].sort((a, b) => a - b);
  const effective = concurrency ?? 1;
  const filtered = measured.filter((e) => (e.concurrency ?? 1) === effective);

  const byProvider = new Map<string, BrowserThroughputEntry[]>();
  for (const e of filtered) {
    const list = byProvider.get(e.provider) ?? [];
    list.push(e);
    byProvider.set(e.provider, list);
  }

  const providers = [...byProvider.entries()].flatMap(([provider, entries]) => {
    const meta = PROVIDERS_BY_ID[provider] ?? { displayName: provider, url: "#" };
    const row = summarizeBrowserThroughput(
      provider,
      entries,
      { displayName: meta.displayName, url: meta.url, browserRegion: meta.browserRegion },
      getUnitPricing(provider),
      getPricePerHour(provider)
    );
    return row ? [row] : [];
  });

  let dateRange: { min: string; max: string } | undefined;
  if (measured.length > 0) {
    const dates = measured.map((e) => e.created_at).filter(Boolean).sort();
    dateRange = { min: dates[0]!, max: dates[dates.length - 1]! };
  }

  return {
    providers: rankBrowserThroughput(providers),
    metadata: {
      date: date && loaded.dates.includes(date) ? date : undefined,
      dateRange,
      availableDates: loaded.dates,
      availableConcurrencyLevels: levels,
    },
  };
}

const measuredTriple = (value: Triple): Triple | null => value.samples > 0 ? value : null;

function historyFromDays(days: { provider: string; date: string; entries: BrowserThroughputEntry[] }[]): ThroughputHistory {
  const dates = new Set<string>();
  const byProvider = new Map<string, { displayName: string; points: ThroughputHistoryPoint[] }>();
  for (const day of days) {
    const measured = day.entries.filter((entry) => entry.warmup !== true && !HIDDEN_PROVIDER_IDS.has(entry.provider));
    if (measured.length === 0) continue;
    const meta = PROVIDERS_BY_ID[day.provider] ?? { displayName: day.provider, url: "#" };
    const row = summarizeBrowserThroughput(
      day.provider,
      measured,
      { displayName: meta.displayName, url: meta.url, browserRegion: meta.browserRegion },
      getUnitPricing(day.provider),
      getPricePerHour(day.provider)
    );
    if (!row) continue;
    dates.add(day.date);
    const series = byProvider.get(day.provider) ?? { displayName: row.displayName, points: [] };
    series.points.push({
      date: day.date,
      actionsPerSecond: measuredTriple(row.actionsPerSecond),
      taskMs: measuredTriple(row.taskMs),
      screenshotMs: measuredTriple(row.perAction.screenshot),
    });
    byProvider.set(day.provider, series);
  }
  return {
    dates: calendarDates([...dates]),
    providers: [...byProvider.entries()]
      .map(([provider, series]) => ({
        provider,
        displayName: series.displayName,
        points: series.points.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

async function loadHistoryFromStore(store: ResultsStore, concurrency: number): Promise<ThroughputHistory> {
  const providerDirs = (await store.list(BENCHMARK)).filter((entry) => entry.isDirectory && !entry.name.startsWith("_"));
  // Every provider and day at once; the store bounds remote requests.
  const perProvider = await Promise.all(providerDirs.map(async (dir) => {
    const providerPath = `${BENCHMARK}/${dir.name}`;
    const dateDirs = (await store.list(providerPath)).filter((entry) => entry.isDirectory && DATE_RE.test(entry.name)).map((entry) => entry.name);
    const days = await Promise.all(dateDirs.map(async (date) => {
      const content = await store.read(`${providerPath}/${date}/c${concurrency}/results.jsonl`);
      if (content == null) return null;
      const entries = parseLines(content, date);
      return { provider: entries.find((entry) => entry.provider)?.provider ?? dir.name, date, entries };
    }));
    return days.filter((day) => day !== null);
  }));
  return historyFromDays(perProvider.flat());
}

async function loadHistoryFromGitHub(concurrency: number, source: ResultsSource = PUBLIC_RESULTS_SOURCE): Promise<ThroughputHistory> {
  const basePath = `results/${BENCHMARK}`;
  const providerDirs = (await listFromGitHub(basePath, source)).filter((entry) => entry.type === "dir" && !entry.name.startsWith("_"));
  // Independent providers load together; each provider's archive stays serial
  // so cold loads have at most one file request per provider in flight.
  const days = await Promise.all(providerDirs.map(async (dir) => {
    const providerDays: { provider: string; date: string; entries: BrowserThroughputEntry[] }[] = [];
    const dates = (await listFromGitHub(`${basePath}/${dir.name}`, source)).filter((entry) => entry.type === "dir" && DATE_RE.test(entry.name)).map((entry) => entry.name);
    for (const date of dates) {
      try {
        const content = await fetchFromGitHub(`${basePath}/${dir.name}/${date}/c${concurrency}/results.jsonl`, source);
        const entries = parseLines(content, date);
        providerDays.push({ provider: entries.find((entry) => entry.provider)?.provider ?? dir.name, date, entries });
      } catch {
        // This provider has no run at this concurrency on this day.
      }
    }
    return providerDays;
  }));
  return historyFromDays(days.flat());
}

// Cache assembled summaries, not raw sessions, across page/API date selections.
// Keep the cache bounded because concurrency is supplied by public requests.
const remoteHistoryCache = new Map<number, { expiresAt: number; value: Promise<ThroughputHistory> }>();
const REMOTE_HISTORY_TTL_MS = 60_000;
const REMOTE_HISTORY_CACHE_LIMIT = 8;

/** Every recorded day at one concurrency, for the throughput history line. */
export async function loadBrowserThroughputHistory(concurrency = 1, source?: ResultsSource): Promise<ThroughputHistory> {
  // Private results are cached by the caller, never in this shared map.
  if (source) return loadHistoryFromGitHub(concurrency, source);
  const store = resultsStoreFor(BENCHMARK, getResultsDir());
  // Local files can change between calls (runner output and local development).
  if (store?.kind === "fs") return loadHistoryFromStore(store, concurrency);
  const cached = remoteHistoryCache.get(concurrency);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const entry = {
    expiresAt: Infinity,
    value: store ? loadHistoryFromStore(store, concurrency) : loadHistoryFromGitHub(concurrency),
  };
  remoteHistoryCache.delete(concurrency);
  remoteHistoryCache.set(concurrency, entry);
  if (remoteHistoryCache.size > REMOTE_HISTORY_CACHE_LIMIT) {
    remoteHistoryCache.delete(remoteHistoryCache.keys().next().value!);
  }
  try {
    // The pending promise also coalesces simultaneous cold requests. Start the
    // freshness window after loading, so a slow archive gets a full minute.
    const history = await entry.value;
    // Results fetched at the deployed commit never change; GitHub's main branch does.
    entry.expiresAt = store ? Infinity : Date.now() + REMOTE_HISTORY_TTL_MS;
    return history;
  } catch (error) {
    if (remoteHistoryCache.get(concurrency) === entry) remoteHistoryCache.delete(concurrency);
    throw error;
  }
}

/** Shared publication policy for the website and API: one complete run day. */
export async function loadPublishedBrowserThroughput(concurrency = 1, date?: string) {
  const history = await loadBrowserThroughputHistory(concurrency);
  const publication = throughputPublication(history, date);
  const leaderboard = await loadBrowserThroughputLeaderboard(concurrency, publication.selectedDate);
  return { leaderboard, history, publication };
}
