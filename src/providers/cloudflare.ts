import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

type SessionResponse = { sessionId?: string; webSocketDebuggerUrl?: string };

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

  private endpoint(sessionId?: string): string {
    const base = `${API_BASE}/accounts/${requireEnv("CLOUDFLARE_ACCOUNT_ID")}/browser-run/devtools/browser`;
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
    // The docs show the session at the top level; accept the usual v4
    // `result` envelope as well.
    const body = (await res.json()) as SessionResponse & { result?: SessionResponse };
    const { sessionId, webSocketDebuggerUrl } = body.result ?? body;
    if (!sessionId || !webSocketDebuggerUrl) {
      throw new Error("Invalid Cloudflare response: missing sessionId or webSocketDebuggerUrl");
    }
    // The websocket takes the same bearer token as the REST API, as a header.
    return { id: sessionId, cdpUrl: webSocketDebuggerUrl, headers };
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
