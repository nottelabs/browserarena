export type PercentileType = "median" | "p90" | "p95";

export type SortByType = "latency" | "reliability" | "price" | "speed";

export interface ProviderFailurePattern {
  stage: string | null;
  messagePreview: string;
  fullMessage: string;
  count: number;
}

export interface ProviderFailureInsights {
  failureCount: number;
  byStage: { stage: string; count: number }[];
  patterns: ProviderFailurePattern[];
}

export interface ProviderStats {
  provider: string;
  displayName: string;
  url: string;
  disclaimer?: string;
  browserRegion?: string;
  runDate?: string;
  vmMeta?: VmMeta;
  totalRuns: number;
  concurrency: number;
  successRate: number;
  medianCreationMs: number;
  medianConnectMs: number;
  medianGotoMs: number;
  medianScriptMs: number;
  medianReleaseMs: number;
  p90CreationMs: number;
  p90ConnectMs: number;
  p90GotoMs: number;
  p90ScriptMs: number;
  p90ReleaseMs: number;
  p95CreationMs: number;
  p95ConnectMs: number;
  p95GotoMs: number;
  p95ScriptMs: number;
  p95ReleaseMs: number;
  totalTimeMs: number;
  p90TotalMs: number;
  p95TotalMs: number;
  medianExtractMs: number;
  medianCrawlMs: number;
  medianFormMs: number;
  medianWorkMs: number;
  medianCostUsd: number | null;
  pricePerHour: number | null;
  perSessionFee: number | null;
  rank: number;
  failureInsights?: ProviderFailureInsights;
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
  availableConcurrencyLevels?: number[];
  vmMeta?: VmMeta;
  vmMetas?: VmMeta[];
}

export interface LeaderboardResult {
  providers: ProviderStats[];
  metadata: LeaderboardMetadata;
}

export interface ProviderCdpEndpointInfo {
  cdpHost: string;
  rttMs: number;
  proxied: boolean;
}

/**
 * TCP+TLS RTT (curl time_appconnect, median of 10) from the benchmark EC2 VMs,
 * 2026-03-26. us-east-1 for most providers, us-west-1 for Browserbase and Notte.
 * For proxied providers this reflects the proxy/CDN edge, not the browser VM.
 * Browser Use used curl -k (cert SAN mismatch).
 */
export const PROVIDER_CDP_ENDPOINT: Record<string, ProviderCdpEndpointInfo> = {
  BROWSERBASE: { cdpHost: "connect.usw2.browserbase.com", rttMs: 62, proxied: false },
  STEEL: { cdpHost: "connect.steel.dev", rttMs: 14, proxied: true },
  NOTTE: { cdpHost: "us-prod.notte.cc", rttMs: 12, proxied: true },
  KERNEL: { cdpHost: "api.onkernel.com", rttMs: 14, proxied: false },
  ANCHORBROWSER: { cdpHost: "connect.anchorbrowser.io", rttMs: 38, proxied: false },
  HYPERBROWSER: { cdpHost: "connect-us-east-1.hyperbrowser.ai", rttMs: 9, proxied: false },
  BROWSER_USE: { cdpHost: "cdp1.browser-use.com", rttMs: 29, proxied: false },
};

/** Benchmark runner VM (`_meta.json`): cloud + region when present. */
export function vmMetaRegionLabel(vmMeta?: VmMeta): string | null {
  if (!vmMeta?.region) return null;
  return vmMeta.cloud
    ? `${vmMeta.cloud.toUpperCase()} ${vmMeta.region}`
    : vmMeta.region;
}
