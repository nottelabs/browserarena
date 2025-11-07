import fs from "fs";
import path from "path";
import { getMedianCostUsd, getPricePerHour, getPerSessionFee } from "./pricing";

const RESULTS_GITHUB_REPO =
  process.env.RESULTS_GITHUB_REPO || "nottelabs/browserarena";
const RESULTS_GITHUB_BRANCH =
  process.env.RESULTS_GITHUB_BRANCH || "main";

interface BenchmarkEntry {
  created_at: string;
  id: string;
  session_creation_ms: number;
  session_connect_ms: number;
  page_goto_ms: number;
  session_release_ms: number;
  provider: string;
  success: boolean;
  error_stage: string | null;
  error_message: string | null;
  cost_usd?: number | null;
}

export type PercentileType = "median" | "p90" | "p95";

export type SortByType = "latency" | "reliability" | "price" | "speed";

export interface ProviderStats {
  provider: string;
  displayName: string;
  url: string;
  disclaimer?: string;
  vmMeta?: VmMeta;
  totalRuns: number;
  successRate: number;
  medianCreationMs: number;
  medianConnectMs: number;
  medianGotoMs: number;
  medianReleaseMs: number;
  p90CreationMs: number;
  p90ConnectMs: number;
  p90GotoMs: number;
  p90ReleaseMs: number;
  p95CreationMs: number;
  p95ConnectMs: number;
  p95GotoMs: number;
  p95ReleaseMs: number;
  totalTimeMs: number;
  p90TotalMs: number;
  p95TotalMs: number;
  medianCostUsd: number | null;
  pricePerHour: number | null;
  perSessionFee: number | null;
  rank: number;
}

export interface VmMeta {
  region?: string;
  instance_type?: string;
  cloud?: string;
  os?: string;
  node_version?: string;
  started_at?: string;
  finished_at?: string;
}

export interface LeaderboardMetadata {
  date?: string;
  dateRange?: { min: string; max: string };
  availableDates?: string[];
  vmMeta?: VmMeta;
}

export interface LeaderboardResult {
  providers: ProviderStats[];
  metadata: LeaderboardMetadata;
}

const PROVIDER_META: Record<
  string,
  { displayName: string; url: string; disclaimer?: string }
> = {
  NOTTE: { displayName: "Notte", url: "https://notte.cc" },
  ANCHORBROWSER: {
    displayName: "Anchor Browser",
    url: "https://anchorbrowser.io",
  },
  BROWSERBASE: { displayName: "Browserbase", url: "https://browserbase.com" },
  HYPERBROWSER: {
    displayName: "Hyperbrowser",
    url: "https://hyperbrowser.ai",
  },
  KERNEL: {
    displayName: "Kernel",
    url: "https://kernel.sh",
    disclaimer: "Data shown is for headless sessions.",
  },
  KERNEL_HEADFUL: {
    displayName: "Kernel (Headful)",
    url: "https://kernel.sh",
  },
  STEEL: { displayName: "Steel", url: "https://steel.dev" },
  BROWSER_USE: { displayName: "Browser Use", url: "https://browser-use.com" },
};


function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(0, idx)];
}

function getResultsDir(): string {
  return path.join(process.cwd(), "..", "..", "results");
}

async function fetchFromGitHub(filePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${RESULTS_GITHUB_REPO}/${RESULTS_GITHUB_BRANCH}/${filePath}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  return res.text();
}

interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
}

async function listFromGitHub(dirPath: string): Promise<GitHubContentItem[]> {
  const url = `https://api.github.com/repos/${RESULTS_GITHUB_REPO}/contents/${dirPath}?ref=${RESULTS_GITHUB_BRANCH}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item: { name: string; path: string; type: string }) => ({
    name: item.name,
    path: item.path,
    type: item.type as "file" | "dir",
  }));
}

function parseJsonlLines(content: string): BenchmarkEntry[] {
  const entries: BenchmarkEntry[] = [];
  for (const line of content.trim().split("\n")) {
    try {
      const entry: BenchmarkEntry = JSON.parse(line);
      entries.push(entry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function loadEntriesFromGitHub(
  benchmark: "hello-browser" | "v0",
  date?: string
): Promise<{ entries: BenchmarkEntry[]; dateRange?: { min: string; max: string } }> {
  const providerMap = new Map<string, BenchmarkEntry[]>();
  const basePath = `results/${benchmark}`;

  // Structure: results/{benchmark}/{provider}/{date}/results.jsonl
  const providerDirs = await listFromGitHub(basePath);
  const dirs = providerDirs.filter(
    (e) => e.type === "dir" && !e.name.startsWith("_")
  );

  for (const dir of dirs) {
    // Find latest date folder for this provider
    const dateDirs = await listFromGitHub(`${basePath}/${dir.name}`);
    const dates = dateDirs
      .filter((e) => e.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    const latestDate = dates[0];
    if (!latestDate) continue;

    try {
      const content = await fetchFromGitHub(
        `${basePath}/${dir.name}/${latestDate}/results.jsonl`
      );
      for (const entry of parseJsonlLines(content)) {
        const existing = providerMap.get(entry.provider) || [];
        existing.push(entry);
        providerMap.set(entry.provider, existing);
      }
    } catch {
      // skip if file doesn't exist
    }
  }

  const entries = Array.from(providerMap.values()).flat();
  let dateRange: { min: string; max: string } | undefined;
  if (entries.length > 0) {
    const dates = entries.map((e) => e.created_at).filter(Boolean).sort();
    dateRange = { min: dates[0]!, max: dates[dates.length - 1]! };
  }
  return { entries, dateRange };
}

function loadEntriesFromFs(
  benchmark: "hello-browser" | "v0",
  date?: string
): { entries: BenchmarkEntry[]; dateRange?: { min: string; max: string }; providerMetaMap: Map<string, VmMeta> } {
  const resultsDir = getResultsDir();
  const providerMap = new Map<string, BenchmarkEntry[]>();
  const providerMetaMap = new Map<string, VmMeta>();
  let dateRange: { min: string; max: string } | undefined;

  // Structure: results/{benchmark}/{provider}/{date}/results.jsonl
  const benchDir = path.join(resultsDir, benchmark);
  if (!fs.existsSync(benchDir)) return { entries: [], providerMetaMap };

  const providerDirs = fs.readdirSync(benchDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"));

  for (const dir of providerDirs) {
    const providerPath = path.join(benchDir, dir.name);
    // Find latest date folder
    const dateDirs = fs.readdirSync(providerPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    const latestDate = dateDirs[0];
    if (!latestDate) continue;

    const runDir = path.join(providerPath, latestDate);
    const resultsFile = path.join(runDir, "results.jsonl");
    if (!fs.existsSync(resultsFile)) continue;

    const content = fs.readFileSync(resultsFile, "utf-8");
    let providerName: string | undefined;
    for (const line of content.trim().split("\n")) {
      try {
        const entry: BenchmarkEntry = JSON.parse(line);
        providerName = entry.provider;
        const existing = providerMap.get(entry.provider) || [];
        existing.push(entry);
        providerMap.set(entry.provider, existing);
      } catch {
        // skip malformed lines
      }
    }

    // Load meta
    if (providerName) {
      const metaFile = path.join(runDir, "_meta.json");
      if (fs.existsSync(metaFile)) {
        try {
          providerMetaMap.set(providerName, JSON.parse(fs.readFileSync(metaFile, "utf-8")));
        } catch { /* skip */ }
      }
    }
  }

  const allEntries = Array.from(providerMap.values()).flat();
  if (allEntries.length > 0) {
    const dates = allEntries.map((e) => e.created_at).filter(Boolean).sort();
    dateRange = { min: dates[0]!, max: dates[dates.length - 1]! };
  }

  return {
    entries: Array.from(providerMap.values()).flat(),
    dateRange,
    providerMetaMap,
  };
}

function listBenchmarkDatesFromFs(benchmark: "v0"): string[] {
  const resultsDir = getResultsDir();
  const v0Dir = path.join(resultsDir, "v0");
  if (!fs.existsSync(v0Dir)) return [];
  return fs
    .readdirSync(v0Dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

async function listBenchmarkDatesFromGitHub(benchmark: "v0"): Promise<string[]> {
  const items = await listFromGitHub("results/v0");
  return items
    .filter((e) => e.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export async function listBenchmarkDates(
  benchmark: "v0"
): Promise<string[]> {
  const resultsDir = getResultsDir();
  if (fs.existsSync(resultsDir)) {
    return listBenchmarkDatesFromFs(benchmark);
  }
  return listBenchmarkDatesFromGitHub(benchmark);
}

export async function loadLeaderboard(
  benchmark: "hello-browser" | "v0" = "hello-browser",
  date?: string,
  _percentile: PercentileType = "median",
  sortBy: SortByType = "latency"
): Promise<LeaderboardResult> {
  const v0Dates = await listBenchmarkDates("v0");
  const effectiveDate =
    benchmark === "v0" ? date || v0Dates[0] : undefined;

  const resultsDir = getResultsDir();
  const useFs = fs.existsSync(resultsDir);
  const fsResult = useFs ? loadEntriesFromFs(benchmark, effectiveDate) : null;
  const ghResult = !useFs ? await loadEntriesFromGitHub(benchmark, effectiveDate) : null;
  const allEntries = fsResult?.entries ?? ghResult?.entries ?? [];
  const dateRange = fsResult?.dateRange ?? ghResult?.dateRange;
  const providerMetaMap = fsResult?.providerMetaMap ?? new Map<string, VmMeta>();

  // Use first available provider meta for the overall VM meta display
  const vmMeta = providerMetaMap.size > 0
    ? providerMetaMap.values().next().value
    : undefined;

  const providerMap = new Map<string, BenchmarkEntry[]>();
  for (const entry of allEntries) {
    const existing = providerMap.get(entry.provider) || [];
    existing.push(entry);
    providerMap.set(entry.provider, existing);
  }

  const stats: ProviderStats[] = [];

  for (const [provider, entries] of providerMap) {
    const meta = PROVIDER_META[provider] || {
      displayName: provider,
      url: "#",
    };
    const successful = entries.filter((e) => e.success);
    const successRate = (successful.length / entries.length) * 100;

    const creationTimes = successful.map((e) => e.session_creation_ms);
    const connectTimes = successful.map((e) => e.session_connect_ms);
    const gotoTimes = successful.map((e) => e.page_goto_ms);
    const releaseTimes = successful.map((e) => e.session_release_ms);

    const medianCreationMs = median(creationTimes);
    const medianConnectMs = median(connectTimes);
    const medianGotoMs = median(gotoTimes);
    const medianReleaseMs = median(releaseTimes);

    const p90CreationMs = percentile(creationTimes, 0.90);
    const p90ConnectMs = percentile(connectTimes, 0.90);
    const p90GotoMs = percentile(gotoTimes, 0.90);
    const p90ReleaseMs = percentile(releaseTimes, 0.90);

    const p95CreationMs = percentile(creationTimes, 0.95);
    const p95ConnectMs = percentile(connectTimes, 0.95);
    const p95GotoMs = percentile(gotoTimes, 0.95);
    const p95ReleaseMs = percentile(releaseTimes, 0.95);

    const totalTimeMs =
      medianCreationMs + medianConnectMs + medianGotoMs + medianReleaseMs;
    const p90TotalMs = p90CreationMs + p90ConnectMs + p90GotoMs + p90ReleaseMs;
    const p95TotalMs = p95CreationMs + p95ConnectMs + p95GotoMs + p95ReleaseMs;


    const successfulEntries = entries.filter((e) => e.success);
    const durationsMs = successfulEntries.map(
      (e) =>
        e.session_creation_ms +
        e.session_connect_ms +
        e.page_goto_ms +
        e.session_release_ms
    );
    let medianCostUsd: number | null = null;
    const withCostUsd = successfulEntries.filter(
      (e): e is typeof e & { cost_usd: number } =>
        typeof (e as { cost_usd?: number }).cost_usd === "number"
    );
    if (withCostUsd.length > 0) {
      const costs = withCostUsd.map((e) => e.cost_usd);
      const sorted = [...costs].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianCostUsd =
        sorted.length % 2 !== 0
          ? sorted[mid]!
          : (sorted[mid - 1]! + sorted[mid]!) / 2;
    } else if (durationsMs.length > 0) {
      medianCostUsd = getMedianCostUsd(provider, durationsMs);
    }

    stats.push({
      provider,
      displayName: meta.displayName,
      url: meta.url,
      ...(meta.disclaimer ? { disclaimer: meta.disclaimer } : {}),
      vmMeta: providerMetaMap.get(provider),
      totalRuns: entries.length,
      successRate,
      medianCreationMs,
      medianConnectMs,
      medianGotoMs,
      medianReleaseMs,
      p90CreationMs,
      p90ConnectMs,
      p90GotoMs,
      p90ReleaseMs,
      p95CreationMs,
      p95ConnectMs,
      p95GotoMs,
      p95ReleaseMs,
      totalTimeMs,
      p90TotalMs,
      p95TotalMs,
      medianCostUsd,
      pricePerHour: getPricePerHour(provider),
      perSessionFee: getPerSessionFee(provider),
      rank: 0,
    });
  }

  const totalKey =
    _percentile === "p95"
      ? "p95TotalMs"
      : _percentile === "p90"
        ? "p90TotalMs"
        : "totalTimeMs";

  if (sortBy === "latency") {
    stats.sort((a, b) => (a[totalKey] as number) - (b[totalKey] as number));
  } else if (sortBy === "reliability") {
    stats.sort((a, b) => {
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return (a[totalKey] as number) - (b[totalKey] as number);
    });
  } else if (sortBy === "price") {
    stats.sort((a, b) => {
      const ca = a.pricePerHour ?? Infinity;
      const cb = b.pricePerHour ?? Infinity;
      if (ca !== cb) return ca - cb;
      const fa = a.perSessionFee ?? 0;
      const fb = b.perSessionFee ?? 0;
      if (fa !== fb) return fa - fb;
      return (a[totalKey] as number) - (b[totalKey] as number);
    });
  } else {
    stats.sort((a, b) => (a[totalKey] as number) - (b[totalKey] as number));
  }
  // Assign ranks with ties: providers sharing the same sort value get the same rank
  const getSortValue = (s: ProviderStats): number => {
    if (sortBy === "price") {
      const price = (s.pricePerHour ?? Infinity) * 1e6 + (s.perSessionFee ?? 0);
      return price;
    }
    if (sortBy === "reliability") {
      // Primary: success rate (desc), secondary: total latency (asc) for tiebreaking
      return -s.successRate * 1e9 + (s[totalKey] as number);
    }
    return s[totalKey] as number;
  };
  let currentRank = 1;
  stats.forEach((s, i) => {
    if (i > 0 && getSortValue(s) !== getSortValue(stats[i - 1])) {
      currentRank = i + 1;
    }
    s.rank = currentRank;
  });

  const metadata: LeaderboardMetadata = {
    availableDates: v0Dates,
    vmMeta,
  };
  if (effectiveDate) {
    metadata.date = effectiveDate;
  }
  if (dateRange) {
    metadata.dateRange = dateRange;
  }

  return { providers: stats, metadata };
}
