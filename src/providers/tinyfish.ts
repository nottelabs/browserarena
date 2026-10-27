import type { ProviderClient, ProviderSession, SessionOptions } from "../types.js";
import { SessionCreationError } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { sanitizeErrorMessage } from "../utils/sanitize.js";
import { msSince, nowNs } from "../utils/time.js";

const API_BASE = "https://api.browser.tinyfish.ai";

export class TinyFishProvider implements ProviderClient {
  readonly name = "TINYFISH";
  readonly proxyUnsupportedReason = "TinyFish country-targeted residential proxies have not been verified in this integration";

  computeCost(seconds: number): number {
    // Duration estimate at $0.002/minute; billing rounding is not published.
    return Math.round((seconds / 60) * 0.002 * 1e8) / 1e8;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    if (opts?.proxyCountry) throw new Error(this.proxyUnsupportedReason);
    const apiKey = requireEnv("TINYFISH_API_KEY");
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      // Start at about:blank and navigate in the benchmark's goto phase.
      // TinyFish otherwise enables a residential proxy by default.
      body: JSON.stringify({ proxy_config: { enabled: false } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = sanitizeErrorMessage((await res.text()).replaceAll(apiKey, "[redacted]"));
      throw Object.assign(new Error(`TinyFish create failed: HTTP ${res.status} - ${body}`), {
        status: res.status,
        requestId: res.headers.get("X-Request-ID"),
      });
    }
    const data = await res.json() as { session_id?: unknown; cdp_url?: unknown };
    const id = typeof data.session_id === "string" ? data.session_id : "";
    if (!id) throw new Error("Invalid TinyFish response: missing session_id");
    const cdpUrl = typeof data.cdp_url === "string" ? data.cdp_url : "";
    const protocol = URL.canParse(cdpUrl) ? new URL(cdpUrl).protocol : null;
    if (protocol !== "ws:" && protocol !== "wss:") {
      const reason = "Invalid TinyFish response: missing or invalid cdp_url";
      const started = nowNs();
      try { await this.release(id); }
      catch (error) {
        throw new SessionCreationError(reason, id,
          error instanceof Error ? error.message : String(error), null);
      }
      throw new SessionCreationError(reason, id, null, msSince(started));
    }
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const apiKey = requireEnv("TINYFISH_API_KEY");
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = sanitizeErrorMessage((await res.text()).replaceAll(apiKey, "[redacted]"));
      throw Object.assign(new Error(`TinyFish release failed: HTTP ${res.status} - ${body}`), {
        status: res.status,
        requestId: res.headers.get("X-Request-ID"),
      });
    }
  }
}
