import fs from "fs";
import path from "path";
import { getMedianCostUsd, getPricePerHour, getPerSessionFee } from "./pricing";

export type {
  PercentileType,
  SortByType,
  ProviderFailurePattern,
  ProviderFailureInsights,
  ProviderStats,
  VmMeta,
  LeaderboardMetadata,
  LeaderboardResult,
  ProviderCdpEndpointInfo,
} from "./data-shared";

export { PROVIDER_CDP_ENDPOINT, vmMetaRegionLabel } from "./data-shared";

import type {
  PercentileType,
  SortByType,
  ProviderFailureInsights,
  ProviderFailurePattern,
  ProviderStats,
  VmMeta,
  LeaderboardMetadata,
  LeaderboardResult,
} from "./data-shared";

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
  concurrency?: number;
  success: boolean;
  error_stage: string | null;
  error_message: string | null;
  error_screenshot_path?: string | null;
  cost_usd?: number | null;
  page_script_ms?: number | null;
  extract_ms?: number | null;
  crawl_ms?: number | null;
  form_ms?: number | null;
  total_work_ms?: number | null;
  _runDate?: string;
}

const PROVIDER_META: Record<
  string,
  { displayName: string; url: string; disclaimer?: string; browserRegion?: string }
> = {
  NOTTE: { displayName: "Notte", url: "https://www.notte.cc", browserRegion: "us-west-2" },
  ANCHORBROWSER: {
    displayName: "Anchor Browser",
    url: "https://www.anchorbrowser.io",
    browserRegion: "us-east-1",
  },
  BROWSERBASE: { displayName: "Browserbase", url: "https://www.browserbase.com", browserRegion: "us-west-2" },
  HYPERBROWSER: {
    displayName: "Hyperbrowser",
    url: "https://www.hyperbrowser.ai",
    browserRegion: "us-east-1",
  },
  KERNEL: {
    displayName: "Kernel",
    url: "https://www.kernel.sh",
    browserRegion: "us-east-1",
  },
  STEEL: { displayName: "Steel", url: "https://www.steel.dev", browserRegion: "us-east-1" },
  BROWSER_USE: { displayName: "Browser Use", url: "https://www.browser-use.com", browserRegion: "us-east-1" },
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

function entryScriptMs(e: BenchmarkEntry): number {
  const v = e.page_script_ms;
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

const FAILURE_PATTERN_CAP = 8;

const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*m/g;
const PRIVATE_IP_RE = /\b(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})\b/g;
const WS_URL_RE = /wss?:\/\/[^\s)"']+/gi;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi;
const SECRET_PARAM_RE = /([?&](?:token|key|api[_-]?key|signature|sig|auth)=)[^&\s]+/gi;
const LONG_HEX_RE = /\b[a-f0-9]{24,}\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function sanitizeFailureText(input: string): string {
  const stripped = input
    .replace(ANSI_ESCAPE_RE, "")
    .replace(BEARER_TOKEN_RE, "Bearer [redacted]")
    .replace(WS_URL_RE, "[redacted websocket url]")
    .replace(SECRET_PARAM_RE, "$1[redacted]")
    .replace(PRIVATE_IP_RE, "[redacted private ip]")
    .replace(UUID_RE, "[redacted id]")
    .replace(LONG_HEX_RE, "[redacted token]");

  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = lines[0] ?? "(no message)";
  return summary.length > 200 ? `${summary.slice(0, 197)}…` : summary;
}

function classifyFailure(message: string, stage: string | null): string {
  const normalized = message.toLowerCase();

  if (/429|rate limit|too many/i.test(normalized)) return "RATE_LIMIT";
  if (/401|403|unauthorized|forbidden/i.test(normalized)) return "AUTH_ERROR";
  if (/5\d\d|bad gateway|cluster is under heavy load|service unavailable/i.test(normalized))
    return "UPSTREAM_5XX";
  if (/4\d\d|bad request|not found/i.test(normalized)) return "UPSTREAM_4XX";
  if (/timeout|timed out|time out/i.test(normalized)) {
    if (stage === "connect_over_cdp") return "CONNECT_TIMEOUT";
    if (stage === "page_goto") return "NAVIGATION_TIMEOUT";
    return "TIMEOUT";
  }
  if (/websocket|cdp|connectovercdp/i.test(normalized)) return "CDP_CONNECT_ERROR";

  return "UNKNOWN";
}

function buildFailureInsights(
  entries: BenchmarkEntry[]
): ProviderFailureInsights | undefined {
  const failed = entries.filter((e) => !e.success);
  if (failed.length === 0) return undefined;

  const byStageMap = new Map<string, number>();
  const patternMap = new Map<
    string,
    {
      stage: string | null;
      messagePreview: string;
      fullMessage: string;
      count: number;
    }
  >();

  for (const e of failed) {
    const stageKey = e.error_stage?.trim() || "unknown";
    byStageMap.set(stageKey, (byStageMap.get(stageKey) ?? 0) + 1);

    const raw = e.error_message?.trim() ?? "";
    const fullMessage = sanitizeFailureText(raw);
    const messagePreview = fullMessage.length > 120 ? `${fullMessage.slice(0, 117)}…` : fullMessage;
    const dedupeKey = `${stageKey}::${fullMessage.slice(0, 400)}`;

    const prev = patternMap.get(dedupeKey);
    if (prev) {
      prev.count += 1;
    } else {
      patternMap.set(dedupeKey, {
        stage: e.error_stage,
        messagePreview,
        fullMessage,
        count: 1,
      });
    }
  }

  const byStage = [...byStageMap.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  const patterns = [...patternMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, FAILURE_PATTERN_CAP);

  return { failureCount: failed.length, byStage, patterns };
}

function getResultsDir(): string {
  return path.join(process.cwd(), "..", "results");
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = JSON.parse(line);
      // Normalize legacy field name
      if (raw.total_agent_ms != null && raw.total_work_ms == null) {
        raw.total_work_ms = raw.total_agent_ms;
      }
      entries.push(raw as BenchmarkEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function loadEntriesFromGitHub(
  benchmark: "hello-browser" | "v0",
  date?: string
): Promise<{
  entries: BenchmarkEntry[];
  dateRange?: { min: string; max: string };
  providerRunDateMap: Map<string, string>;
}> {
  const providerMap = new Map<string, BenchmarkEntry[]>();
  const providerRunDateMap = new Map<string, string>();
  const basePath = `results/${benchmark}`;

  // Structure: results/{benchmark}/{provider}/{date}/results.jsonl
  const providerDirs = await listFromGitHub(basePath);
  const dirs = providerDirs.filter(
    (e) => e.type === "dir" && !e.name.startsWith("_")
  );

  for (const dir of dirs) {
    const dateDirs = await listFromGitHub(`${basePath}/${dir.name}`);
    const dates = dateDirs
      .filter((e) => e.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();

    if (benchmark === "hello-browser") {
      // Scan all dates to find the latest date per concurrency level
      const loadedConcLevels = new Set<string>();

      for (const dateDir of dates) {
        const dateContents = await listFromGitHub(`${basePath}/${dir.name}/${dateDir}`);
        const concDirs = dateContents
          .filter((e) => e.type === "dir" && /^c\d+$/.test(e.name))
          .map((e) => e.name);

        if (concDirs.length === 0) {
          // Legacy top-level results.jsonl
          if (!loadedConcLevels.has("c1")) {
            loadedConcLevels.add("c1");
            try {
              const content = await fetchFromGitHub(`${basePath}/${dir.name}/${dateDir}/results.jsonl`);
              const lines = parseJsonlLines(content);
              for (const entry of lines) {
                entry._runDate = dateDir;
                const existing = providerMap.get(entry.provider) || [];
                existing.push(entry);
                providerMap.set(entry.provider, existing);
              }
            } catch { /* skip */ }
          }
          continue;
        }

        for (const concDir of concDirs) {
          if (loadedConcLevels.has(concDir)) continue;
          loadedConcLevels.add(concDir);
          try {
            const content = await fetchFromGitHub(`${basePath}/${dir.name}/${dateDir}/${concDir}/results.jsonl`);
            const lines = parseJsonlLines(content);
            for (const entry of lines) {
              entry._runDate = dateDir;
              const existing = providerMap.get(entry.provider) || [];
              existing.push(entry);
              providerMap.set(entry.provider, existing);
            }
          } catch { /* skip */ }
        }
      }
    } else {
      // v0: use latest date only
      const latestDate = dates[0];
      if (!latestDate) continue;

      try {
        const content = await fetchFromGitHub(`${basePath}/${dir.name}/${latestDate}/results.jsonl`);
        const lines = parseJsonlLines(content);
        for (const entry of lines) {
          const existing = providerMap.get(entry.provider) || [];
          existing.push(entry);
          providerMap.set(entry.provider, existing);
        }
        if (lines.length > 0) {
          providerRunDateMap.set(lines[0]!.provider, latestDate);
        }
      } catch { /* skip */ }
    }
  }

  const entries = Array.from(providerMap.values()).flat();
  let dateRange: { min: string; max: string } | undefined;
  if (entries.length > 0) {
    const dates = entries.map((e) => e.created_at).filter(Boolean).sort();
    dateRange = { min: dates[0]!, max: dates[dates.length - 1]! };
  }
  return { entries, dateRange, providerRunDateMap };
}

function loadEntriesFromFs(
  benchmark: "hello-browser" | "v0",
  date?: string
): {
  entries: BenchmarkEntry[];
  dateRange?: { min: string; max: string };
  providerMetaMap: Map<string, VmMeta>;
  providerRunDateMap: Map<string, string>;
} {
  const resultsDir = getResultsDir();
  const providerMap = new Map<string, BenchmarkEntry[]>();
  const providerMetaMap = new Map<string, VmMeta>();
  const providerRunDateMap = new Map<string, string>();
  let dateRange: { min: string; max: string } | undefined;

  // Structure: results/{benchmark}/{provider}/{date}/results.jsonl
  const benchDir = path.join(resultsDir, benchmark);
  if (!fs.existsSync(benchDir))
    return { entries: [], providerMetaMap, providerRunDateMap };

  const providerDirs = fs.readdirSync(benchDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"));

  for (const dir of providerDirs) {
    const providerPath = path.join(benchDir, dir.name);
    const dateDirs = fs.readdirSync(providerPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();

    if (benchmark === "hello-browser") {
      // For hello-browser, scan all dates to find the latest date per concurrency level.
      // e.g. c1 may be on 2026-03-22 while c16 is on 2026-03-25.
      const loadedConcLevels = new Set<string>();
      let providerName: string | undefined;

      for (const dateDir of dateDirs) {
        const runDir = path.join(providerPath, dateDir);
        const concDirs = fs.readdirSync(runDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && /^c\d+$/.test(e.name))
          .map((e) => e.name);

        // Also handle legacy top-level results.jsonl (no c{N} subdir)
        if (concDirs.length === 0) {
          const resultsFile = path.join(runDir, "results.jsonl");
          if (!loadedConcLevels.has("c1") && fs.existsSync(resultsFile)) {
            loadedConcLevels.add("c1");
            const content = fs.readFileSync(resultsFile, "utf-8");
            for (const line of content.trim().split("\n")) {
              try {
                const entry: BenchmarkEntry = JSON.parse(line);
                entry._runDate = dateDir;
                providerName = entry.provider;
                const existing = providerMap.get(entry.provider) || [];
                existing.push(entry);
                providerMap.set(entry.provider, existing);
              } catch { /* skip */ }
            }
          }
          continue;
        }

        for (const concDir of concDirs) {
          if (loadedConcLevels.has(concDir)) continue; // already have latest for this level
          const resultsFile = path.join(runDir, concDir, "results.jsonl");
          if (!fs.existsSync(resultsFile)) continue;

          loadedConcLevels.add(concDir);
          const content = fs.readFileSync(resultsFile, "utf-8");
          for (const line of content.trim().split("\n")) {
            try {
              const entry: BenchmarkEntry = JSON.parse(line);
              entry._runDate = dateDir;
              providerName = entry.provider;
              const existing = providerMap.get(entry.provider) || [];
              existing.push(entry);
              providerMap.set(entry.provider, existing);
            } catch { /* skip */ }
          }

          // Load meta from this concurrency dir
          if (providerName) {
            if (!providerMetaMap.has(providerName)) {
              const metaFile = path.join(runDir, concDir, "_meta.json");
              if (fs.existsSync(metaFile)) {
                try {
                  providerMetaMap.set(providerName, JSON.parse(fs.readFileSync(metaFile, "utf-8")));
                } catch { /* skip */ }
              }
            }
          }
        }
      }
    } else {
      // v0 and other benchmarks: use latest date only
      const latestDate = dateDirs[0];
      if (!latestDate) continue;

      const runDir = path.join(providerPath, latestDate);
      const resultsFile = path.join(runDir, "results.jsonl");
      if (!fs.existsSync(resultsFile)) continue;

      let providerName: string | undefined;
      const content = fs.readFileSync(resultsFile, "utf-8");
      for (const line of content.trim().split("\n")) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw: any = JSON.parse(line);
          // Normalize legacy field name
          if (raw.total_agent_ms != null && raw.total_work_ms == null) {
            raw.total_work_ms = raw.total_agent_ms;
          }
          const entry: BenchmarkEntry = raw;
          providerName = entry.provider;
          const existing = providerMap.get(entry.provider) || [];
          existing.push(entry);
          providerMap.set(entry.provider, existing);
        } catch { /* skip */ }
      }

      if (providerName) {
        providerRunDateMap.set(providerName, latestDate);
        const metaFile = path.join(runDir, "_meta.json");
        if (fs.existsSync(metaFile)) {
          try {
            providerMetaMap.set(providerName, JSON.parse(fs.readFileSync(metaFile, "utf-8")));
          } catch { /* skip */ }
        }
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
    providerRunDateMap,
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
  sortBy: SortByType = "latency",
  concurrency?: number
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
  const providerRunDateMap =
    fsResult?.providerRunDateMap ?? ghResult?.providerRunDateMap ?? new Map<string, string>();

  // Discover available concurrency levels from entries
  const concurrencySet = new Set<number>();
  for (const e of allEntries) {
    concurrencySet.add(e.concurrency ?? 1);
  }
  const availableConcurrencyLevels = [...concurrencySet].sort((a, b) => a - b);

  // Filter entries by concurrency level (default to 1 for hello-browser)
  const effectiveConcurrency = concurrency ?? (benchmark === "hello-browser" ? 1 : undefined);
  const EXCLUDED_PROVIDERS = new Set(["KERNEL_HEADFUL"]);
  const filteredEntries = (effectiveConcurrency != null
    ? allEntries.filter((e) => (e.concurrency ?? 1) === effectiveConcurrency)
    : allEntries
  ).filter((e) => !EXCLUDED_PROVIDERS.has(e.provider));

  // Use first available provider meta for the overall VM meta display
  const vmMeta = providerMetaMap.size > 0
    ? providerMetaMap.values().next().value
    : undefined;

  const providerMap = new Map<string, BenchmarkEntry[]>();
  for (const entry of filteredEntries) {
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

    const creationTimes = successful.map((e) => e.session_creation_ms ?? 0);
    const connectTimes = successful.map((e) => e.session_connect_ms ?? 0);
    const gotoTimes = successful.map((e) => e.page_goto_ms ?? 0);
    const scriptTimes = successful.map((e) => entryScriptMs(e) ?? 0);
    const releaseTimes = successful.map((e) => e.session_release_ms ?? 0);

    const medianCreationMs = median(creationTimes);
    const medianConnectMs = median(connectTimes);
    const medianGotoMs = median(gotoTimes);
    const medianScriptMs = median(scriptTimes);
    const medianReleaseMs = median(releaseTimes);

    const p90CreationMs = percentile(creationTimes, 0.90);
    const p90ConnectMs = percentile(connectTimes, 0.90);
    const p90GotoMs = percentile(gotoTimes, 0.90);
    const p90ScriptMs = percentile(scriptTimes, 0.90);
    const p90ReleaseMs = percentile(releaseTimes, 0.90);

    const p95CreationMs = percentile(creationTimes, 0.95);
    const p95ConnectMs = percentile(connectTimes, 0.95);
    const p95GotoMs = percentile(gotoTimes, 0.95);
    const p95ScriptMs = percentile(scriptTimes, 0.95);
    const p95ReleaseMs = percentile(releaseTimes, 0.95);

    // v0 fields
    const extractTimes = successful.map((e) => e.extract_ms ?? 0);
    const crawlTimes = successful.map((e) => e.crawl_ms ?? 0);
    const formTimes = successful.map((e) => e.form_ms ?? 0);
    const workTimes = successful.map((e) => e.total_work_ms ?? 0);
    const medianExtractMs = median(extractTimes);
    const medianCrawlMs = median(crawlTimes);
    const medianFormMs = median(formTimes);
    const medianWorkMs = median(workTimes);
    const p90WorkMs = percentile(workTimes, 0.90);
    const p95WorkMs = percentile(workTimes, 0.95);

    // For v0, total = creation + connect + work + release
    // For hello-browser, total = creation + connect + goto + script + release
    const isV0 = medianWorkMs > 0;
    const totalTimeMs = isV0
      ? medianCreationMs + medianConnectMs + medianWorkMs + medianReleaseMs
      : medianCreationMs + medianConnectMs + medianGotoMs + medianScriptMs + medianReleaseMs;
    const p90TotalMs = isV0
      ? p90CreationMs + p90ConnectMs + p90WorkMs + p90ReleaseMs
      : p90CreationMs + p90ConnectMs + p90GotoMs + p90ScriptMs + p90ReleaseMs;
    const p95TotalMs = isV0
      ? p95CreationMs + p95ConnectMs + p95WorkMs + p95ReleaseMs
      : p95CreationMs + p95ConnectMs + p95GotoMs + p95ScriptMs + p95ReleaseMs;

    const successfulEntries = entries.filter((e) => e.success);
    const durationsMs = successfulEntries.map(
      (e) =>
        e.session_creation_ms +
        e.session_connect_ms +
        e.page_goto_ms +
        entryScriptMs(e) +
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

    // Derive runDate from filtered entries (handles different dates per concurrency level)
    const runDate = entries[0]?._runDate ?? providerRunDateMap.get(provider);
    const failureInsights = buildFailureInsights(entries);
    stats.push({
      provider,
      displayName: meta.displayName,
      url: meta.url,
      ...(meta.disclaimer ? { disclaimer: meta.disclaimer } : {}),
      ...(meta.browserRegion ? { browserRegion: meta.browserRegion } : {}),
      ...(runDate ? { runDate } : {}),
      vmMeta: providerMetaMap.get(provider),
      totalRuns: entries.length,
      concurrency: entries[0]?.concurrency ?? 1,
      successRate,
      ...(failureInsights ? { failureInsights } : {}),
      medianCreationMs,
      medianConnectMs,
      medianGotoMs,
      medianScriptMs,
      medianReleaseMs,
      p90CreationMs,
      p90ConnectMs,
      p90GotoMs,
      p90ScriptMs,
      p90ReleaseMs,
      p95CreationMs,
      p95ConnectMs,
      p95GotoMs,
      p95ScriptMs,
      p95ReleaseMs,
      totalTimeMs,
      p90TotalMs,
      p95TotalMs,
      medianExtractMs,
      medianCrawlMs,
      medianFormMs,
      medianWorkMs,
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

  // Collect unique VM configs by region
  const uniqueVmMetas: VmMeta[] = [];
  const seenRegions = new Set<string>();
  for (const meta of providerMetaMap.values()) {
    const key = `${meta.cloud ?? ""}::${meta.region ?? ""}::${meta.instance_type ?? ""}`;
    if (!seenRegions.has(key)) {
      seenRegions.add(key);
      uniqueVmMetas.push(meta);
    }
  }

  const metadata: LeaderboardMetadata = {
    availableDates: v0Dates,
    availableConcurrencyLevels: availableConcurrencyLevels.length > 1 ? availableConcurrencyLevels : undefined,
    vmMeta,
    vmMetas: uniqueVmMetas.length > 0 ? uniqueVmMetas : undefined,
  };
  if (effectiveDate) {
    metadata.date = effectiveDate;
  }
  if (dateRange) {
    metadata.dateRange = dateRange;
  }

  return { providers: stats, metadata };
}
