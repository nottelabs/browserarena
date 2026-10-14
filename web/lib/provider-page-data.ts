import fs from "fs";
import path from "path";
import { fetchFromGitHub, getResultsDir, loadHistoricalLeaderboard } from "./data";
import type { HistoricalProviderPoint } from "./data-shared";
import { loadBrowserThroughputHistory } from "./browser-throughput-data";
import {
  AGENT_ACTION_TYPES,
  summarizeBrowserThroughput,
  type AgentActionType,
  type BrowserThroughputEntry,
  type ThroughputHistoryPoint,
  type Triple,
} from "./browser-throughput-shared";
import { getPricePerHour, getUnitPricing } from "./pricing";
import { loadProxyGetHistory } from "./proxy-get-history";
import type { ProxyGetStats } from "./proxy-get";
import { PROVIDERS_BY_ID } from "./providers";
import { PROXY_COUNTRIES } from "../../src/benchmarks/proxy-get/schema";

export type ProxyCountry = (typeof PROXY_COUNTRIES)[number];

export interface PhaseSamples {
  total: number[];
  create: number[];
  connect: number[];
  goto: number[];
  release: number[];
}

export interface ProviderLifecycle {
  points: HistoricalProviderPoint[];
  day: string | null;
  runs: number;
  successes: number;
  samples: PhaseSamples;
}

export interface ActionPercentiles {
  median: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface ProviderThroughput {
  points: ThroughputHistoryPoint[];
  day: string | null;
  runs: number;
  successes: number;
  actionsPerSecond: number[];
  taskMs: number[];
  screenshotMs: number[];
  actions: Record<AgentActionType, ActionPercentiles>;
}

export interface ProviderProxyDay {
  date: string;
  medianGetMs: number | null;
  medianFirstByteMs: number | null;
  costPerSuccessUsd: number | null;
  workloadKey: string | null;
}

export interface ProviderProxy {
  country: ProxyCountry;
  status: "measured" | "unsupported" | "absent";
  note: string | null;
  stats: ProxyGetStats | null;
  history: ProviderProxyDay[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function folderName(providerId: string): string {
  return providerId.toLowerCase().replace(/_/g, "-");
}

function pickDate(dates: string[], requested?: string): string | null {
  if (requested && DATE_RE.test(requested) && dates.includes(requested)) return requested;
  return dates.at(-1) ?? null;
}

async function readDayFile(benchmark: string, providerId: string, date: string, relative: string): Promise<string | null> {
  const folder = folderName(providerId);
  const resultsDir = getResultsDir();
  if (fs.existsSync(resultsDir)) {
    const direct = path.join(resultsDir, benchmark, folder, date, relative);
    if (fs.existsSync(direct)) return fs.readFileSync(direct, "utf-8");
    const bench = path.join(resultsDir, benchmark);
    if (!fs.existsSync(bench)) return null;
    for (const dir of fs.readdirSync(bench, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith("_") || dir.name === "kernel-headful") continue;
      const file = path.join(bench, dir.name, date, relative);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(`"provider":"${providerId}"`)) return content;
    }
    return null;
  }
  try {
    return await fetchFromGitHub(`results/${benchmark}/${folder}/${date}/${relative}`);
  } catch {
    return null;
  }
}

function parseJsonl<T>(content: string): T[] {
  const rows: T[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

function emptyPhases(): PhaseSamples {
  return { total: [], create: [], connect: [], goto: [], release: [] };
}

function lifecycleFromFile(content: string | null, providerId: string): Pick<ProviderLifecycle, "runs" | "successes" | "samples"> {
  const samples = emptyPhases();
  if (!content) return { runs: 0, successes: 0, samples };
  let runs = 0;
  let successes = 0;
  for (const entry of parseJsonl<{
    provider: string;
    warmup?: boolean;
    concurrency?: number;
    success: boolean;
    session_creation_ms?: number | null;
    session_connect_ms?: number | null;
    page_goto_ms?: number | null;
    session_release_ms?: number | null;
    page_script_ms?: number | null;
  }>(content)) {
    if (entry.provider !== providerId || entry.warmup === true || (entry.concurrency ?? 1) !== 1) continue;
    runs += 1;
    if (!entry.success) continue;
    successes += 1;
    const create = entry.session_creation_ms ?? 0;
    const connect = entry.session_connect_ms ?? 0;
    const goto = entry.page_goto_ms ?? 0;
    const release = entry.session_release_ms ?? 0;
    const script = typeof entry.page_script_ms === "number" ? entry.page_script_ms : 0;
    samples.create.push(create);
    samples.connect.push(connect);
    samples.goto.push(goto);
    samples.release.push(release);
    samples.total.push(create + connect + goto + script + release);
  }
  return { runs, successes, samples };
}

function emptyActions(): Record<AgentActionType, ActionPercentiles> {
  return Object.fromEntries(AGENT_ACTION_TYPES.map((type) => [type, { median: 0, p95: 0, p99: 0, samples: 0 }])) as Record<AgentActionType, ActionPercentiles>;
}

function triplePercentiles(triple: Triple): ActionPercentiles {
  return { median: triple.median, p95: triple.p95, p99: triple.p99, samples: triple.samples };
}

function throughputFromFile(content: string | null, providerId: string, date: string): Omit<ProviderThroughput, "points" | "day"> {
  const empty = { runs: 0, successes: 0, actionsPerSecond: [] as number[], taskMs: [] as number[], screenshotMs: [] as number[], actions: emptyActions() };
  if (!content) return empty;
  const info = PROVIDERS_BY_ID[providerId];
  const entries = parseJsonl<BrowserThroughputEntry>(content).filter((entry) =>
    entry.provider === providerId && entry.warmup !== true && (entry.concurrency ?? 1) === 1
  );
  for (const entry of entries) {
    if (!Array.isArray(entry.actions)) entry.actions = [];
    entry._runDate = date;
  }
  if (!entries.length) return empty;
  const successful = entries.filter((entry) => entry.success);
  const measured = successful.filter((entry) => entry.actions.length > 0 && entry.task_ms != null);
  const row = summarizeBrowserThroughput(
    providerId,
    successful,
    { displayName: info?.displayName ?? providerId, url: info?.url ?? "#", browserRegion: info?.browserRegion },
    getUnitPricing(providerId),
    getPricePerHour(providerId)
  );
  return {
    runs: entries.length,
    successes: entries.filter((entry) => entry.success).length,
    actionsPerSecond: measured.flatMap((entry) => typeof entry.actions_per_second === "number" ? [entry.actions_per_second] : []),
    taskMs: measured.flatMap((entry) => typeof entry.task_ms === "number" ? [entry.task_ms] : []),
    screenshotMs: measured.flatMap((entry) => entry.actions.filter((action) => action.type === "screenshot" && action.success && !action.skipped).map((action) => action.duration_ms)),
    actions: row
      ? Object.fromEntries(AGENT_ACTION_TYPES.map((type) => [type, triplePercentiles(row.perAction[type])])) as Record<AgentActionType, ActionPercentiles>
      : emptyActions(),
  };
}

export async function loadProviderPage(providerId: string, options: { date?: string; country?: string } = {}): Promise<{
  lifecycle: ProviderLifecycle | null;
  throughput: ProviderThroughput | null;
  proxy: ProviderProxy;
}> {
  const country = PROXY_COUNTRIES.includes(options.country as ProxyCountry) ? options.country as ProxyCountry : "US";
  const [history, throughputHistory, proxyHistory] = await Promise.all([
    loadHistoricalLeaderboard("hello-browser", 1),
    loadBrowserThroughputHistory(1),
    loadProxyGetHistory(country, options.date),
  ]);
  const lifecycleSeries = history.providers.find((series) => series.provider === providerId) ?? null;
  const lifecycleDates = lifecycleSeries?.points.map((point) => point.date) ?? [];
  const lifecycleDay = pickDate(lifecycleDates, options.date);
  const lifecycleFile = lifecycleDay ? await readDayFile("hello-browser", providerId, lifecycleDay, "c1/results.jsonl") : null;
  const lifecycleCounts = lifecycleFromFile(lifecycleFile, providerId);

  const throughputSeries = throughputHistory.providers.find((series) => series.provider === providerId) ?? null;
  const throughputDates = throughputSeries?.points.map((point) => point.date) ?? [];
  const throughputDay = pickDate(throughputDates, options.date);
  const throughputFile = throughputDay ? await readDayFile("browser-throughput", providerId, throughputDay, "c1/results.jsonl") : null;
  const throughputCounts = throughputFromFile(throughputFile, providerId, throughputDay ?? "");

  // The selected day drops a provider whose latest suite is older, or whose
  // target differs. The overview keeps that suite, which is what the chart shows.
  const proxyStats = proxyHistory.overview.providers.find((provider) => provider.provider === providerId) ?? null;
  const proxyDays = proxyHistory.days.map((day) => {
    const provider = day.providers.find((item) => item.provider === providerId);
    return {
      date: day.date,
      medianGetMs: provider?.medianGetMs ?? null,
      medianFirstByteMs: provider?.medianFirstByteMs ?? null,
      costPerSuccessUsd: provider?.costPerSuccessUsd ?? null,
      workloadKey: provider?.workloadKey ?? null,
    };
  });
  const firstMeasured = proxyDays.findIndex((day) => day.workloadKey != null);
  const providerDays = firstMeasured === -1 ? [] : proxyDays.slice(firstMeasured);

  return {
    lifecycle: lifecycleSeries ? {
      points: lifecycleSeries.points,
      day: lifecycleDay,
      ...lifecycleCounts,
    } : null,
    throughput: throughputSeries ? {
      points: throughputSeries.points,
      day: throughputDay,
      ...throughputCounts,
    } : null,
    proxy: {
      country,
      status: proxyStats?.status ?? (providerDays.some((day) => day.medianGetMs != null || day.medianFirstByteMs != null) ? "measured" : "absent"),
      note: proxyStats?.status === "unsupported"
        ? proxyStats.samples[0]?.error_message ?? "Residential proxy integration is unavailable for this country."
        : null,
      stats: proxyStats?.status === "measured" ? proxyStats : null,
      history: providerDays,
    },
  };
}
