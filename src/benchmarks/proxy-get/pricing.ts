import fs from "node:fs";
import type { ProxyGetRecord, ProxyPricing } from "./schema.js";

const base = {
  billingIncrementSeconds: 1, minimumSessionSeconds: 0, sessionFeeUsd: 0,
  bytesPerGb: 1_000_000_000, minimumProxyBytes: 0, proxyIncrementBytes: 1,
  checkedAt: "2026-10-08",
};

/** Marginal list-price estimates: subscriptions and included credits are excluded. */
export const DEFAULT_PROXY_PRICING: Record<string, ProxyPricing> = {
  NOTTE: { ...base, plan: "Listed usage", browserPerHourUsd: 0, proxyPerGbUsd: 10,
    sourceUrls: ["https://www.notte.cc/pricing"] },
  STEEL: { ...base, plan: "Launch", browserPerHourUsd: 0.1, proxyPerGbUsd: 10,
    billingIncrementSeconds: 60, minimumSessionSeconds: 60,
    sourceUrls: ["https://docs.steel.dev/overview/pricinglimits"] },
  BROWSERBASE: { ...base, checkedAt: "2026-10-11", plan: "Developer list rates; account plan unconfirmed",
    browserPerHourUsd: 0.12, proxyPerGbUsd: 12,
    billingIncrementSeconds: 60, minimumSessionSeconds: 60,
    minimumProxyBytes: 1_000_000, proxyIncrementBytes: 1_000_000,
    sourceUrls: ["https://www.browserbase.com/pricing", "https://docs.browserbase.com/platform/identity/proxies", "https://docs.browserbase.com/guides/cost-optimization"] },
  KERNEL: { ...base, plan: "Hobbyist; headless; unmetered managed proxies",
    browserPerHourUsd: 0.06, proxyPerGbUsd: 0,
    sourceUrls: ["https://kernel.sh/docs/info/pricing", "https://kernel.sh/docs/proxies/overview"] },
  KERNEL_HEADFUL: { ...base, plan: "Hobbyist; headful; unmetered managed proxies",
    browserPerHourUsd: 0.48, proxyPerGbUsd: 0,
    sourceUrls: ["https://kernel.sh/docs/info/pricing", "https://kernel.sh/docs/proxies/overview"] },
  HYPERBROWSER: { ...base, plan: "Listed credits", browserPerHourUsd: 0.1, proxyPerGbUsd: 10,
    sourceUrls: ["https://hyperbrowser.ai/docs/pricing"] },
  ANCHORBROWSER: { ...base, plan: "Infrastructure", browserPerHourUsd: 0.05, proxyPerGbUsd: 8,
    billingIncrementSeconds: 60, minimumSessionSeconds: 60, sessionFeeUsd: 0.01,
    sourceUrls: ["https://docs.anchorbrowser.io/pricing"] },
  BROWSER_USE: { ...base, plan: "Listed usage", browserPerHourUsd: 0.02, proxyPerGbUsd: 5,
    billingIncrementSeconds: 60, minimumSessionSeconds: 60, bytesPerGb: 1024 ** 3,
    sourceUrls: ["https://browser-use.com/pricing", "https://docs.browser-use.com/cloud/guides/billing"] },
  TILION: { ...base, checkedAt: "2026-10-11", plan: "Published browser rate; inferred credit-based usage estimate",
    browserPerHourUsd: 0.03, proxyPerGbUsd: 0.2,
    sessionFeeUsd: 0.0004, failedLaunchFeeUsd: 0.0004, proxyIncrementBytes: 1_000_000,
    estimateNote: "Estimated from Tilion's published $0.03/browser-hour and the configured account's 150 credits/hour: $0.0002/credit, $0.20/GB at 1 credit/MB, and $0.0004/session at 2 credits/session. Traffic uses decimal MB rounded up. Failed launches are budgeted as one session fee with no additional unobserved runtime or traffic. Subscriptions and included credits are excluded; this is an inferred usage estimate, not an invoice.",
    sourceUrls: ["https://tilion.com/blog/stealth-is-a-speed-problem", "https://docs.tilion.dev/reference/usage"] },
};

export function loadProxyPricing(file?: string): Record<string, ProxyPricing> {
  const result = structuredClone(DEFAULT_PROXY_PRICING);
  if (!file) return result;
  const overrides: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("Pricing config must be an object keyed by provider ID");
  }
  for (const [provider, override] of Object.entries(overrides)) {
    if (!result[provider] || !override || typeof override !== "object" || Array.isArray(override)) {
      throw new Error(`Invalid pricing override: ${provider}`);
    }
    const pricing = { ...result[provider], ...override } as ProxyPricing;
    for (const field of ["browserPerHourUsd", "billingIncrementSeconds", "minimumSessionSeconds",
      "sessionFeeUsd", "bytesPerGb", "minimumProxyBytes", "proxyIncrementBytes"] as const) {
      if (!Number.isFinite(pricing[field]) || pricing[field] < 0) throw new Error(`Invalid ${provider}.${field}`);
    }
    if (pricing.billingIncrementSeconds <= 0 || pricing.bytesPerGb <= 0 || pricing.proxyIncrementBytes <= 0
      || (pricing.proxyPerGbUsd !== null && (!Number.isFinite(pricing.proxyPerGbUsd) || pricing.proxyPerGbUsd < 0))
      || typeof pricing.plan !== "string" || !pricing.plan || typeof pricing.checkedAt !== "string"
      || !Array.isArray(pricing.sourceUrls) || !pricing.sourceUrls.every(url => typeof url === "string" && /^https?:\/\//.test(url))) {
      throw new Error(`Invalid pricing for ${provider}`);
    }
    if ((pricing.failedLaunchFeeUsd !== undefined && (!Number.isFinite(pricing.failedLaunchFeeUsd) || pricing.failedLaunchFeeUsd < 0))
      || (pricing.estimateNote !== undefined && typeof pricing.estimateNote !== "string")) {
      throw new Error(`Invalid pricing assumptions for ${provider}`);
    }
    result[provider] = pricing;
  }
  return result;
}

/** Explicit launch-failure estimates apply only when no session or usage was returned. */
export function estimateProxyAttemptCost(pricing: ProxyPricing | null,
  attempt: Pick<ProxyGetRecord, "session_wall_ms" | "transfer_bytes" | "session_id" | "error_stage" | "cleanup_error">) {
  if (pricing?.failedLaunchFeeUsd !== undefined && attempt.session_wall_ms === null
    && attempt.session_id === null && attempt.error_stage === "session_create"
    && !attempt.cleanup_error && attempt.transfer_bytes === 0) {
    return { browser_cost_usd: pricing.failedLaunchFeeUsd, proxy_cost_usd: 0, cost_usd: pricing.failedLaunchFeeUsd };
  }
  return estimateProxyCost(pricing, attempt.session_wall_ms, attempt.transfer_bytes);
}

export function estimateProxyCost(pricing: ProxyPricing | null, wallMs: number | null, bytes: number) {
  if (!pricing || wallMs === null) return { browser_cost_usd: null, proxy_cost_usd: null, cost_usd: null };
  const seconds = Math.max(pricing.minimumSessionSeconds,
    Math.ceil(wallMs / 1000 / pricing.billingIncrementSeconds) * pricing.billingIncrementSeconds);
  const billedBytes = Math.max(pricing.minimumProxyBytes,
    Math.ceil(bytes / pricing.proxyIncrementBytes) * pricing.proxyIncrementBytes);
  const browserCost = pricing.sessionFeeUsd + seconds / 3600 * pricing.browserPerHourUsd;
  const proxyCost = pricing.proxyPerGbUsd === null ? null : billedBytes / pricing.bytesPerGb * pricing.proxyPerGbUsd;
  return { browser_cost_usd: browserCost, proxy_cost_usd: proxyCost,
    cost_usd: proxyCost === null ? null : browserCost + proxyCost };
}
