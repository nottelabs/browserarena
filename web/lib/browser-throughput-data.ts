/**
 * Loads `results/browser-throughput/<provider>/<date>/c<N>/results.jsonl` from disk,
 * or from GitHub when the results tree is not on the filesystem, and builds
 * the browser-throughput leaderboard. Latest run date per provider, like hello-browser.
 */

import fs from "fs";
import path from "path";
import { fetchFromGitHub, getResultsDir, listFromGitHub } from "./data";
import { calendarDates } from "./history-range";
import { PROVIDERS_BY_ID } from "./providers";
import { getPricePerHour, getUnitPricing } from "./pricing";
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
const EXCLUDED_PROVIDERS = new Set(["KERNEL_HEADFUL"]);
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

function loadFromFs(date?: string): { entries: BrowserThroughputEntry[]; dates: string[] } {
  const benchDir = path.join(getResultsDir(), BENCHMARK);
  if (!fs.existsSync(benchDir)) return { entries: [], dates: [] };
  const entries: BrowserThroughputEntry[] = [];
  const availableDates = new Set<string>();

  const providerDirs = fs
    .readdirSync(benchDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"));

  for (const dir of providerDirs) {
    const providerPath = path.join(benchDir, dir.name);
    const dateDirs = fs
      .readdirSync(providerPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const name of dateDirs) availableDates.add(name);
    const latestDate = date && dateDirs.includes(date) ? date : date ? undefined : dateDirs[0];
    if (!latestDate) continue;

    const runDir = path.join(providerPath, latestDate);
    const concDirs = fs
      .readdirSync(runDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && CONC_RE.test(e.name))
      .map((e) => e.name);
    for (const concDir of concDirs) {
      const file = path.join(runDir, concDir, "results.jsonl");
      if (!fs.existsSync(file)) continue;
      entries.push(...parseLines(fs.readFileSync(file, "utf-8"), latestDate));
    }
  }
  return { entries, dates: [...availableDates].sort() };
}

async function loadFromGitHub(date?: string): Promise<{ entries: BrowserThroughputEntry[]; dates: string[] }> {
  const basePath = `results/${BENCHMARK}`;
  const entries: BrowserThroughputEntry[] = [];
  const availableDates = new Set<string>();
  const providerDirs = (await listFromGitHub(basePath)).filter(
    (e) => e.type === "dir" && !e.name.startsWith("_")
  );

  for (const dir of providerDirs) {
    const dates = (await listFromGitHub(`${basePath}/${dir.name}`))
      .filter((e) => e.type === "dir" && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const name of dates) availableDates.add(name);
    const latestDate = date && dates.includes(date) ? date : date ? undefined : dates[0];
    if (!latestDate) continue;

    const concDirs = (await listFromGitHub(`${basePath}/${dir.name}/${latestDate}`))
      .filter((e) => e.type === "dir" && CONC_RE.test(e.name))
      .map((e) => e.name);
    for (const concDir of concDirs) {
      try {
        const content = await fetchFromGitHub(`${basePath}/${dir.name}/${latestDate}/${concDir}/results.jsonl`);
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
  date?: string
): Promise<BrowserThroughputLeaderboardResult> {
  const loaded = fs.existsSync(getResultsDir()) ? loadFromFs(date) : await loadFromGitHub(date);
  const allEntries = loaded.entries;

  const measured = allEntries.filter(
    (e) => e.warmup !== true && !EXCLUDED_PROVIDERS.has(e.provider)
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
    const measured = day.entries.filter((entry) => entry.warmup !== true && !EXCLUDED_PROVIDERS.has(entry.provider));
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

function loadHistoryFromFs(concurrency: number): ThroughputHistory {
  const benchDir = path.join(getResultsDir(), BENCHMARK);
  if (!fs.existsSync(benchDir)) return { dates: [], providers: [] };
  const days: { provider: string; date: string; entries: BrowserThroughputEntry[] }[] = [];
  const providerDirs = fs.readdirSync(benchDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"));
  for (const dir of providerDirs) {
    const providerPath = path.join(benchDir, dir.name);
    const dateDirs = fs.readdirSync(providerPath, { withFileTypes: true }).filter((entry) => entry.isDirectory() && DATE_RE.test(entry.name)).map((entry) => entry.name);
    for (const date of dateDirs) {
      const file = path.join(providerPath, date, `c${concurrency}`, "results.jsonl");
      if (!fs.existsSync(file)) continue;
      const entries = parseLines(fs.readFileSync(file, "utf-8"), date);
      days.push({ provider: entries.find((entry) => entry.provider)?.provider ?? dir.name, date, entries });
    }
  }
  return historyFromDays(days);
}

async function loadHistoryFromGitHub(concurrency: number): Promise<ThroughputHistory> {
  const basePath = `results/${BENCHMARK}`;
  const days: { provider: string; date: string; entries: BrowserThroughputEntry[] }[] = [];
  const providerDirs = (await listFromGitHub(basePath)).filter((entry) => entry.type === "dir" && !entry.name.startsWith("_"));
  for (const dir of providerDirs) {
    const dates = (await listFromGitHub(`${basePath}/${dir.name}`)).filter((entry) => entry.type === "dir" && DATE_RE.test(entry.name)).map((entry) => entry.name);
    for (const date of dates) {
      try {
        const content = await fetchFromGitHub(`${basePath}/${dir.name}/${date}/c${concurrency}/results.jsonl`);
        const entries = parseLines(content, date);
        days.push({ provider: entries.find((entry) => entry.provider)?.provider ?? dir.name, date, entries });
      } catch {
        // This provider has no run at this concurrency on this day.
      }
    }
  }
  return historyFromDays(days);
}

/** Every recorded day at one concurrency, for the throughput history line. */
export async function loadBrowserThroughputHistory(concurrency = 1): Promise<ThroughputHistory> {
  return fs.existsSync(getResultsDir()) ? loadHistoryFromFs(concurrency) : loadHistoryFromGitHub(concurrency);
}
