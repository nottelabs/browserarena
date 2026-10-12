import type { ProviderName, ProxyCountry } from "../../types.js";

export const PROXY_COUNTRIES = ["US", "FR", "BR", "IN", "JP"] as const;
export const COUNTRY_NAMES: Record<ProxyCountry, string> = {
  US: "United States", FR: "France", BR: "Brazil", IN: "India", JP: "Japan",
};

export interface ProxyPricing {
  plan: string;
  browserPerHourUsd: number;
  billingIncrementSeconds: number;
  minimumSessionSeconds: number;
  sessionFeeUsd: number;
  /** Optional explicit budgeting assumption for a launch that returns no session. */
  failedLaunchFeeUsd?: number;
  estimateNote?: string;
  proxyPerGbUsd: number | null;
  bytesPerGb: number;
  minimumProxyBytes: number;
  proxyIncrementBytes: number;
  sourceUrls: string[];
  checkedAt: string;
}

export interface ProxyGetRecord {
  benchmark: "proxy-get";
  version: 1;
  run_id: string;
  created_at: string;
  provider: ProviderName;
  session_id: string | null;
  country: ProxyCountry;
  observed_country: string | null;
  country_verification_url: string;
  proxy_type: "residential";
  browser_region: string;
  url: string;
  bootstrap_url: string;
  expected_bytes: number;
  expected_sha256: string;
  timeout_ms: number;
  connection_mode: "warm-origin-fresh-session";
  status: "success" | "failed" | "unsupported";
  session_creation_ms: number | null;
  session_connect_ms: number | null;
  session_release_ms: number | null;
  session_wall_ms: number | null;
  first_byte_ms: number | null;
  headers_ms: number | null;
  get_ms: number | null;
  bytes_received: number;
  http_status: number | null;
  protocol: string | null;
  transfer_bytes: number;
  transfer_bytes_source: "provider" | "browser-observed";
  browser_cost_usd: number | null;
  proxy_cost_usd: number | null;
  cost_usd: number | null;
  pricing: ProxyPricing | null;
  error_stage: string | null;
  error_message: string | null;
  cleanup_error: string | null;
  usage_error: string | null;
  /** Bounded, sanitized network evidence; never contains credentials or bodies. */
  diagnostics?: {
    session_config?: Record<string, string | number | boolean>;
    phase_ms: Record<string, number>;
    network: {
      phase: string;
      endpoint: string;
      elapsed_ms: number;
      http_status?: number;
      protocol?: string;
      headers?: Record<string, string>;
      bytes_received?: number;
      encoded_bytes?: number;
      finished_ms?: number;
      error?: string;
      canceled?: boolean;
      blocked_reason?: string;
      cors_error?: string;
    }[];
    browser_errors: { phase: string; elapsed_ms: number; message: string }[];
  };
  /** Post-run context from runner or target logs; measured values remain unchanged. */
  infrastructure_note?: string;
  /** Dated recalculation; original pricing, traffic, and costs remain intact. */
  cost_reconciliation?: {
    checked_at: string;
    note: string;
    pricing: ProxyPricing;
    transfer_bytes: number;
    transfer_bytes_source: "provider" | "browser-observed";
    browser_cost_usd: number;
    proxy_cost_usd: number;
    cost_usd: number;
  };
}

export function parseCountries(input: string): ProxyCountry[] {
  const countries = [...new Set(input.split(",").map(c => c.trim().toUpperCase()))];
  if (!countries.length || countries.some(c => !PROXY_COUNTRIES.includes(c as ProxyCountry))) {
    throw new Error("--countries must contain only US, FR, BR, IN, JP");
  }
  return countries as ProxyCountry[];
}
