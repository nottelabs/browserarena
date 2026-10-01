import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

// Cloudflare Browser Run, driven from outside Workers through its CDP endpoints.
// The API token needs the "Browser Rendering - Edit" permission.
export class CloudflareProvider implements ProviderClient {
  readonly name = "CLOUDFLARE";

  computeCost(seconds: number): number {
    // Workers Paid: $0.09 per browser hour past the 10 included each month,
    // metered in seconds (developers.cloudflare.com/browser-run/pricing).
    const perHour = 0.09;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  // Cloudflare's guides spell this route `browser-run` since the product was
  // renamed; the API reference and the official SDK still use `browser-rendering`.
  private endpoint(sessionId?: string): string {
    const base = `${API_BASE}/accounts/${requireEnv("CLOUDFLARE_ACCOUNT_ID")}/browser-rendering/devtools/browser`;
    return sessionId ? `${base}/${sessionId}` : base;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${requireEnv("CLOUDFLARE_API_TOKEN")}` };
  }

  async create(): Promise<ProviderSession> {
    const headers = this.authHeaders();
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloudflare create failed: HTTP ${res.status} - ${body}`);
    }
    const { sessionId, webSocketDebuggerUrl } = (await res.json()) as {
      sessionId?: string;
      webSocketDebuggerUrl?: string;
    };
    if (!sessionId) throw new Error("Invalid Cloudflare response: missing sessionId");
    // The URL is optional in the API schema; a session is always reachable at
    // its own endpoint over wss.
    const cdpUrl = webSocketDebuggerUrl ?? this.endpoint(sessionId).replace("https://", "wss://");
    // The websocket takes the same bearer token as the REST API, as a header.
    return { id: sessionId, cdpUrl, headers };
  }

  async release(id: string): Promise<void> {
    const res = await fetch(this.endpoint(id), {
      method: "DELETE",
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cloudflare close failed: HTTP ${res.status} - ${body}`);
    }
  }
}
