import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright-core";
import type { ProviderClient, ProviderSession, ProxyCountry } from "../../types.js";
import { SessionCreationError } from "../../types.js";
import { msSince, nowNs } from "../../utils/time.js";
import { sanitizeErrorMessage } from "../../utils/sanitize.js";
import type { ProxyGetRecord, ProxyPricing } from "./schema.js";
import { estimateProxyAttemptCost } from "./pricing.js";
import { countryExpression, getExpression } from "./browser-script.js";
import { collectProxyDiagnostics } from "./diagnostics.js";
import { validateProxyGetUrls } from "./validate.js";
import { readProxyResults } from "./output.js";

export interface ProxyGetOptions {
  url: string;
  bootstrapUrl: string;
  countryUrl: string;
  expectedBytes: number;
  expectedSha256: string;
  timeoutMs: number;
}

const BROWSER_REGIONS: Record<string, string> = {
  STEEL: "us-east-1", BROWSERBASE: "us-east-1", KERNEL: "provider-default",
  KERNEL_HEADFUL: "provider-default", NOTTE: "provider-default",
  HYPERBROWSER: "us-east", ANCHORBROWSER: "provider-default", BROWSER_USE: "provider-default",
  LIGHTPANDA: "us-west", BROWSERLESS: "us-west", CLOUDFLARE: "global", AWS_AGENTCORE: "us-east-1",
};

function message(error: unknown) {
  return sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
}

export async function runProxyGet(
  provider: ProviderClient, country: ProxyCountry, options: ProxyGetOptions,
  pricing: ProxyPricing | null, runId: string = randomUUID()
): Promise<ProxyGetRecord> {
  const result: ProxyGetRecord = {
    benchmark: "proxy-get", version: 1, run_id: runId, created_at: new Date().toISOString(),
    provider: provider.name, session_id: null, country, observed_country: null, country_verification_url: options.countryUrl,
    proxy_type: "residential", browser_region: provider.name === "TILION"
      ? `requested-region:${country.toLowerCase()}` : BROWSER_REGIONS[provider.name] ?? "unknown",
    url: options.url, bootstrap_url: options.bootstrapUrl, expected_bytes: options.expectedBytes,
    expected_sha256: options.expectedSha256, timeout_ms: options.timeoutMs,
    connection_mode: "warm-origin-fresh-session", status: "failed",
    session_creation_ms: null, session_connect_ms: null, session_release_ms: null, session_wall_ms: null,
    first_byte_ms: null, headers_ms: null, get_ms: null, bytes_received: 0, http_status: null,
    protocol: null, transfer_bytes: 0, transfer_bytes_source: "browser-observed",
    browser_cost_usd: null, proxy_cost_usd: null, cost_usd: null, pricing,
    error_stage: null, error_message: null, cleanup_error: null, usage_error: null,
    diagnostics: { phase_ms: {}, network: [], browser_errors: [] },
  };
  if (!provider.proxyCountries?.includes(country)) {
    result.status = "unsupported";
    result.error_stage = "proxy_support";
    result.error_message = provider.proxyUnsupportedReason ?? "Country-targeted native residential proxy integration is not verified";
    return result;
  }
  validateProxyGetUrls(options.url, options.bootstrapUrl, options.countryUrl);
  const wallStart = nowNs();
  let session: ProviderSession | null = null;
  let browser: Browser | null = null;
  const traffic = new Map<string, number>();
  let stage = "session_create";
  let phaseStart = nowNs();
  const setStage = (next: string) => {
    result.diagnostics!.phase_ms[stage] = msSince(phaseStart);
    stage = next;
    phaseStart = nowNs();
  };
  try {
    const createStart = nowNs();
    session = await provider.create({ proxyCountry: country });
    if (session.configuration) result.diagnostics!.session_config = session.configuration;
    result.session_id = session.id;
    result.session_creation_ms = msSince(createStart);
    setStage("connect_over_cdp");
    const connectStart = nowNs();
    browser = await chromium.connectOverCDP(session.cdpUrl, { timeout: options.timeoutMs });
    result.session_connect_ms = msSince(connectStart);
    setStage("page_setup");
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    collectProxyDiagnostics(cdp, page, [options.url, options.bootstrapUrl, options.countryUrl], () => stage, result.diagnostics!);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    cdp.on("Network.dataReceived", event => {
      traffic.set(event.requestId, (traffic.get(event.requestId) ?? 0) + event.encodedDataLength);
    });
    cdp.on("Network.loadingFinished", event => traffic.set(event.requestId, event.encodedDataLength));
    // A controlled same-origin document permits fetch+WebCrypto without turning
    // off browser security. This warms the origin; the recorded mode says so.
    await page.goto(options.bootstrapUrl, { waitUntil: "load", timeout: options.timeoutMs });
    setStage("country_verification");
    const geo = await page.evaluate(countryExpression(options.countryUrl, options.timeoutMs)) as {country: string; bytes: number};
    result.observed_country = geo.country;
    result.transfer_bytes += geo.bytes;
    if (geo.country !== country) throw new Error(`Expected exit country ${country}, observed ${geo.country}`);
    setStage("get");
    const target = new URL(options.url);
    target.searchParams.set("benchmark_nonce", randomUUID());
    const measured = await page.evaluate(getExpression(target.toString(), options.timeoutMs, options.expectedBytes)) as {
      first_byte_ms: number | null; headers_ms: number | null; get_ms: number | null;
      bytes_received: number; http_status: number | null; protocol: string | null;
      transfer_bytes: number; sha256: string | null; error: string | null;
    };
    result.first_byte_ms = measured.first_byte_ms;
    result.headers_ms = measured.headers_ms;
    result.get_ms = measured.get_ms;
    result.bytes_received = measured.bytes_received;
    result.http_status = measured.http_status;
    result.protocol = measured.protocol;
    result.transfer_bytes += Math.max(measured.transfer_bytes, measured.bytes_received);
    // Bootstrap is billable too. The browser observes bytes without moving the
    // payload over CDP; provider counters replace these estimates when available.
    result.transfer_bytes += await page.evaluate("performance.getEntriesByType('navigation')[0]?.transferSize || 0") as number;
    if (measured.error) throw new Error(measured.error);
    setStage("response_validation");
    if (measured.bytes_received !== options.expectedBytes) throw new Error(`Expected ${options.expectedBytes} bytes, received ${measured.bytes_received}`);
    if (measured.sha256 !== options.expectedSha256) throw new Error("GET payload SHA-256 mismatch");
    result.status = "success";
  } catch (error) {
    result.error_stage = stage;
    result.error_message = message(error);
    if (error instanceof SessionCreationError) {
      result.session_id = error.sessionId;
      result.cleanup_error = error.cleanupError === null ? null : message(error.cleanupError);
      result.session_release_ms = error.releaseMs;
      if (error.releaseMs !== null) result.session_wall_ms = msSince(wallStart);
    }
  } finally {
    setStage("cleanup");
    result.transfer_bytes = Math.max(result.transfer_bytes, [...traffic.values()].reduce((sum, bytes) => sum + bytes, 0));
    if (session) {
      const releaseStart = nowNs();
      try {
        await provider.release(session.id);
        result.session_release_ms = msSince(releaseStart);
        result.session_wall_ms = msSince(wallStart);
      } catch (error) {
        // Successful GETs stay in the speed distribution; the open-ended bill
        // is unknown rather than being understated as a completed session.
        result.cleanup_error = message(error);
      }
      if (provider.getProxyBytes && !result.cleanup_error) {
        try {
          const bytes = await provider.getProxyBytes(session.id);
          if (bytes !== null && Number.isFinite(bytes) && bytes >= result.transfer_bytes) {
            result.transfer_bytes = bytes;
            result.transfer_bytes_source = "provider";
          } else result.usage_error = "Provider usage unavailable or not finalized; browser bytes are a lower bound";
        } catch (error) { result.usage_error = message(error); }
      }
    }
    if (browser) {
      try { await browser.close(); } catch (error) { result.cleanup_error ??= message(error); }
    }
    Object.assign(result, estimateProxyAttemptCost(pricing, result));
    result.diagnostics!.phase_ms.cleanup = msSince(phaseStart);
  }
  return result;
}

export async function runProxyGetSuite(providers: { client: ProviderClient; out: string }[],
  options: ProxyGetOptions & { runs: number; countries: ProxyCountry[]; rate?: number; runId?: string },
  pricing: Record<string, ProxyPricing>) {
  validateProxyGetUrls(options.url, options.bootstrapUrl, options.countryUrl);
  const runId = options.runId ?? randomUUID();
  // Scheduled batches share a daily ID and increase a cumulative attempt target.
  // Count failures too: resuming a batch never retries failed measured requests.
  const jobs = providers.flatMap(p => {
    const previous = readProxyResults(p.out);
    const existing = previous.filter(row => row.run_id === runId);
    if (existing.some(row => row.provider !== p.client.name || row.version !== 1
      || row.url !== options.url || row.bootstrap_url !== options.bootstrapUrl
      || row.country_verification_url !== options.countryUrl || row.expected_bytes !== options.expectedBytes
      || row.expected_sha256 !== options.expectedSha256 || row.timeout_ms !== options.timeoutMs
      || row.connection_mode !== "warm-origin-fresh-session" || row.proxy_type !== "residential")) {
      throw new Error(`Cannot resume ${p.client.name}: daily suite workload changed; use a new run ID`);
    }
    return options.countries.flatMap(country => {
      const supported = p.client.proxyCountries?.includes(country);
      const rows = existing.filter(row => row.country === country);
      if (rows.some(row => (row.status !== "unsupported") !== Boolean(supported))) {
        throw new Error(`Cannot resume ${p.client.name} ${country}: proxy support changed; use a new run ID`);
      }
      const remaining = Math.max(0, (supported ? options.runs : 1) - rows.length);
      return Array.from({ length: remaining }, () => ({ ...p, country }));
    });
  });
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [jobs[i], jobs[j]] = [jobs[j]!, jobs[i]!];
  }
  const lastStart = new Map<string, number>();
  for (const job of jobs) {
    const rate = options.rate ?? (job.client.name.startsWith("KERNEL") ? 10 : undefined);
    const remaining = rate ? (lastStart.get(job.client.name) ?? 0) + 60_000 / rate - Date.now() : 0;
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    lastStart.set(job.client.name, Date.now());
    const record = await runProxyGet(job.client, job.country, options, pricing[job.client.name] ?? null, runId);
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    fs.appendFileSync(job.out, JSON.stringify(record) + "\n");
    console.error(`[PROXY_GET] run=${runId} session=${record.session_id ?? "-"} ${job.client.name} ${job.country} ${record.status} stage=${record.error_stage ?? "-"} get=${record.get_ms ?? "-"}ms bytes=${record.bytes_received} cost=${record.cost_usd ?? "unknown"} ${record.error_message ?? ""}`);
    if (record.status === "failed" || record.cleanup_error) console.error(`[PROXY_GET_FAILURE] ${JSON.stringify({
      run_id: runId, session_id: record.session_id, country: record.country, error_stage: record.error_stage,
      error_message: record.error_message, cleanup_error: record.cleanup_error, diagnostics: record.diagnostics,
    })}`);
  }
}
