/**
 * Loads `results/browser-throughput/<provider>/<date>/c<N>/results.jsonl` from disk,
 * or from GitHub when the results tree is not on the filesystem, and builds
 * the browser-throughput leaderboard. Latest run date per provider, like hello-browser.
 */

import fs from "fs";
import path from "path";
import { fetchFromGitHub, getResultsDir, listFromGitHub } from "./data";
import { PROVIDERS_BY_ID } from "./providers";
import { getPricePerHour, getUnitPricing } from "./pricing";
import {
  rankBrowserThroughput,
  summarizeBrowserThroughput,
  type BrowserThroughputEntry,
  type BrowserThroughputLeaderboardResult,
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

function loadFromFs(): BrowserThroughputEntry[] {
  const benchDir = path.join(getResultsDir(), BENCHMARK);
  if (!fs.existsSync(benchDir)) return [];
  const entries: BrowserThroughputEntry[] = [];

  const providerDirs = fs
    .readdirSync(benchDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"));

  for (const dir of providerDirs) {
    const providerPath = path.join(benchDir, dir.name);
    const latestDate = fs
      .readdirSync(providerPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()[0];
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
  return entries;
}

async function loadFromGitHub(): Promise<BrowserThroughputEntry[]> {
  const basePath = `results/${BENCHMARK}`;
  const entries: BrowserThroughputEntry[] = [];
  const providerDirs = (await listFromGitHub(basePath)).filter(
    (e) => e.type === "dir" && !e.name.startsWith("_")
  );

  for (const dir of providerDirs) {
    const dates = (await listFromGitHub(`${basePath}/${dir.name}`))
      .filter((e) => e.type === "dir" && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    const latestDate = dates[0];
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
  return entries;
}

export async function loadBrowserThroughputLeaderboard(
  concurrency?: number
): Promise<BrowserThroughputLeaderboardResult> {
  const allEntries = fs.existsSync(getResultsDir()) ? loadFromFs() : await loadFromGitHub();

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
    metadata: { dateRange, availableConcurrencyLevels: levels },
  };
}
