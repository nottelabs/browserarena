import type { ProviderClient, ProviderSession, SessionOptions } from "../types.js";
import { SessionCreationError } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { sanitizeErrorMessage } from "../utils/sanitize.js";
import { msSince, nowNs } from "../utils/time.js";

const DEFAULT_BASE = "https://api.specstream.ai";
// $0.10/hour billed by the second (https://specstream.ai/agents.md).
const PER_HOUR_USD = 0.1;

function apiBase(): string {
  return (process.env.SPECSTREAM_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
}

export class SpecStreamProvider implements ProviderClient {
  readonly name = "SPECSTREAM";
  readonly proxyUnsupportedReason =
    "SpecStream browser sessions egress from Madrid (eu-es) without country-targeted residential proxies";

  computeCost(seconds: number): number {
    return Math.round((Math.max(0, seconds) / 3600) * PER_HOUR_USD * 1e8) / 1e8;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    if (opts?.proxyCountry) throw new Error(this.proxyUnsupportedReason);
    const apiKey = requireEnv("SPECSTREAM_API_KEY");
    const res = await fetch(`${apiBase()}/v1/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = sanitizeErrorMessage((await res.text()).replaceAll(apiKey, "[redacted]"));
      throw Object.assign(new Error(`SpecStream create failed: HTTP ${res.status} - ${body}`), {
        status: res.status,
        requestId: res.headers.get("X-Request-ID"),
      });
    }
    const parsed = (await res.json()) as {
      data?: { id?: unknown; connect_url?: unknown };
      id?: unknown;
      connect_url?: unknown;
    };
    const payload = parsed.data ?? parsed;
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) throw new Error("Invalid SpecStream response: missing id");
    const cdpUrl = typeof payload.connect_url === "string" ? payload.connect_url : "";
    const protocol = URL.canParse(cdpUrl) ? new URL(cdpUrl).protocol : null;
    if (protocol !== "ws:" && protocol !== "wss:") {
      const reason = "Invalid SpecStream response: missing or invalid connect_url";
      const started = nowNs();
      try {
        await this.release(id);
      } catch (error) {
        throw new SessionCreationError(
          reason,
          id,
          error instanceof Error ? error.message : String(error),
          null
        );
      }
      throw new SessionCreationError(reason, id, null, msSince(started));
    }
    return { id, cdpUrl, configuration: { headless: true } };
  }

  async release(id: string): Promise<void> {
    const apiKey = requireEnv("SPECSTREAM_API_KEY");
    const res = await fetch(`${apiBase()}/v1/browser/sessions/${encodeURIComponent(id)}/release`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = sanitizeErrorMessage((await res.text()).replaceAll(apiKey, "[redacted]"));
      throw Object.assign(new Error(`SpecStream release failed: HTTP ${res.status} - ${body}`), {
        status: res.status,
        requestId: res.headers.get("X-Request-ID"),
      });
    }
  }
}
