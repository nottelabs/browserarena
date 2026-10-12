import fs from "node:fs";
import path from "node:path";
import type { ProxyGetRecord } from "../../src/benchmarks/proxy-get/schema";
import { PROVIDERS_BY_ID } from "./providers";
import { proxyAttemptCost, proxyCostExplanation } from "./proxy-get-cost";

export { PROXY_COUNTRIES, COUNTRY_NAMES } from "../../src/benchmarks/proxy-get/schema";
export type { ProxyGetRecord } from "../../src/benchmarks/proxy-get/schema";

export interface ProxyGetStats {
  provider: string;
  displayName: string;
  url: string;
  country: string;
  runDate: string;
  browserRegion: string;
  status: "measured" | "unsupported";
  attempts: number;
  successes: number;
  medianGetMs: number | null;
  medianFirstByteMs: number | null;
  minGetMs: number | null;
  maxGetMs: number | null;
  medianMbps: number | null;
  totalCostUsd: number | null;
  costPerSuccessUsd: number | null;
  estimatedTraffic: boolean;
  costExplanation: string;
  samples: ProxyGetRecord[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function proxyGetWorkloadKey(record: ProxyGetRecord): string {
  return JSON.stringify([record.version, record.url, record.bootstrap_url, record.country_verification_url,
    record.expected_bytes, record.expected_sha256, record.timeout_ms, record.connection_mode, record.proxy_type]);
}

export function summarizeProxyGet(entries: ProxyGetRecord[], country: string) {
  // Never combine different payloads, timeouts, or repeated suites into one ranking.
  const latest = entries.reduce<ProxyGetRecord | null>((a, b) => !a || b.created_at > a.created_at ? b : a, null);
  if (!latest) return { providers: [] as ProxyGetStats[], workload: null, latestAt: null };
  const compatible = entries.filter(e => proxyGetWorkloadKey(e) === proxyGetWorkloadKey(latest));
  const byProvider = new Map<string, ProxyGetRecord[]>();
  for (const entry of compatible) {
    const group = byProvider.get(entry.provider) ?? [];
    group.push(entry);
    byProvider.set(entry.provider, group);
  }
  const providers = [...byProvider].flatMap(([provider, records]): ProxyGetStats[] => {
    const last = records.reduce((a, b) => b.created_at > a.created_at ? b : a);
    const samples = records.filter(e => e.run_id === last.run_id && e.country === country);
    if (!samples.length) return [];
    const countryLast = samples.reduce((a, b) => b.created_at > a.created_at ? b : a);
    const measured = samples.filter(e => e.status !== "unsupported");
    const succeeded = measured.filter(e => e.status === "success" && e.get_ms !== null);
    const times = succeeded.map(e => e.get_ms!);
    const totalCostUsd = measured.length && measured.every(e => proxyAttemptCost(e).cost_usd !== null)
      ? measured.reduce((sum, e) => sum + proxyAttemptCost(e).cost_usd!, 0) : null;
    const info = PROVIDERS_BY_ID[provider];
    return [{ provider, displayName: info?.displayName ?? provider.replace(/_/g, " "), url: info?.url ?? "https://www.kernel.sh",
      country, runDate: last.created_at.slice(0, 10), browserRegion: countryLast.browser_region,
      status: measured.length ? "measured" : "unsupported", attempts: measured.length, successes: succeeded.length,
      medianGetMs: median(times), medianFirstByteMs: median(succeeded.flatMap(e => e.first_byte_ms === null ? [] : [e.first_byte_ms])),
      minGetMs: times.length ? Math.min(...times) : null, maxGetMs: times.length ? Math.max(...times) : null,
      medianMbps: median(succeeded.flatMap(e => e.get_ms! > 0 ? [e.bytes_received * 8 / (e.get_ms! * 1000)] : [])),
      totalCostUsd, costPerSuccessUsd: totalCostUsd !== null && succeeded.length ? totalCostUsd / succeeded.length : null,
      estimatedTraffic: measured.some(e => proxyAttemptCost(e).transfer_bytes_source !== "provider"),
      costExplanation: proxyCostExplanation(samples), samples,
    }];
  });
  providers.sort((a, b) => (a.medianGetMs ?? Infinity) - (b.medianGetMs ?? Infinity) || a.displayName.localeCompare(b.displayName));
  return { providers, workload: { url: latest.url, bytes: latest.expected_bytes, sha256: latest.expected_sha256,
    timeoutMs: latest.timeout_ms, mode: latest.connection_mode }, latestAt: latest.created_at };
}

export function parseProxyGetJsonl(content: string): ProxyGetRecord[] {
  return content.split("\n").flatMap(line => {
    if (!line.trim()) return [];
    try {
      const e = JSON.parse(line) as ProxyGetRecord;
      if (e.benchmark !== "proxy-get" || e.version !== 1 || !e.run_id || !e.created_at || !e.provider
        || !["success", "failed", "unsupported"].includes(e.status)
        || !["US", "FR", "BR", "IN", "JP"].includes(e.country)) return [];
      return [e];
    } catch { return []; }
  });
}

export async function loadProxyGetEntries(allDates = false): Promise<ProxyGetRecord[]> {
  const base = path.resolve(process.env.RESULTS_DIR || path.join(process.cwd(), "..", "results"), "proxy-get");
  let entries: ProxyGetRecord[] = [];
  // Vercel's build-time files are immutable: published daily data comes from GitHub.
  if (fs.existsSync(base) && (!process.env.VERCEL || process.env.RESULTS_DIR)) {
    for (const provider of fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory())) {
      const dir = path.join(base, provider.name);
      const dates = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort();
      for (const date of allDates ? dates : dates.slice(-1)) {
        const file = path.join(dir, date, "results.jsonl");
        if (fs.existsSync(file)) entries.push(...parseProxyGetJsonl(fs.readFileSync(file, "utf-8")));
      }
    }
  } else {
    const repo = process.env.RESULTS_GITHUB_REPO || "nottelabs/browserarena";
    // Preview data belongs to the deployed revision, which may not be on main.
    // Production keeps following main as the runner publishes new daily samples.
    const branch = process.env.RESULTS_GITHUB_BRANCH
      || (process.env.VERCEL_ENV === "preview"
        ? process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_REF : undefined)
      || "main";
    const list = async (dir: string): Promise<{ name: string; type: string }[]> => {
      const response = await fetch(`https://api.github.com/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(branch)}`, { next: { revalidate: 60 } });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Proxy results listing failed: HTTP ${response.status}`);
      return await response.json();
    };
    const indexResponse = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/results/proxy-get/index.json`, { next: { revalidate: 60 } });
    let indexedProviders: { name: string; dates: string[] }[] | null = null;
    if (indexResponse.ok) {
      const index = await indexResponse.json();
      if (index.version !== 1 || !Array.isArray(index.providers) || index.providers.some((p: { name?: unknown; dates?: unknown }) =>
        typeof p.name !== "string" || !/^[a-z0-9-]+$/.test(p.name) || !Array.isArray(p.dates)
        || p.dates.some(d => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)))) {
        throw new Error("Invalid proxy results index");
      }
      indexedProviders = index.providers;
    } else if (indexResponse.status !== 404) {
      throw new Error(`Proxy results index fetch failed: HTTP ${indexResponse.status}`);
    }
    const providers = indexedProviders ?? (await list("results/proxy-get")).filter(d => d.type === "dir");
    const loaded = await Promise.all(providers.map(async p => {
      const dates = ("dates" in p ? p.dates : (await list(`results/proxy-get/${p.name}`))
        .filter(d => d.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name)).toSorted();
      // Load sequentially per provider to keep repository requests bounded.
      const records: ProxyGetRecord[] = [];
      for (const date of allDates ? dates : dates.slice(-1)) {
        const response = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/results/proxy-get/${p.name}/${date}/results.jsonl`, { next: { revalidate: 60 } });
        if (!response.ok) throw new Error(`Proxy results fetch failed: HTTP ${response.status}`);
        records.push(...parseProxyGetJsonl(await response.text()));
      }
      return records;
    }));
    entries = loaded.flat();
  }
  return entries;
}

export async function loadProxyGet(country = "US") {
  return summarizeProxyGet(await loadProxyGetEntries(), country);
}
