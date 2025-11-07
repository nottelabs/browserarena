import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

export class BrowserUseProvider implements ProviderClient {
  readonly name = "BROWSER_USE";

  computeCost(seconds: number): number {
    // $0.06/hr charged upfront, refunded proportionally on stop. Min 1 minute.
    const perHour = 0.06;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  async create(): Promise<ProviderSession> {
    const apiKey = requireEnv("BROWSER_USE_API_KEY");
    const res = await fetch("https://api.browser-use.com/api/v2/browsers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Browser-Use-API-Key": apiKey,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Browser Use create failed: HTTP ${res.status} - ${body}`);
    }
    const data = await res.json();
    const id = data.id;
    const cdpUrl = data.cdpUrl;
    if (!id || !cdpUrl) throw new Error("Invalid Browser Use response: missing id or cdpUrl");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const apiKey = requireEnv("BROWSER_USE_API_KEY");
    const res = await fetch(`https://api.browser-use.com/api/v2/browsers/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Browser-Use-API-Key": apiKey,
      },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Browser Use stop failed: HTTP ${res.status} - ${body}`);
    }
  }
}
