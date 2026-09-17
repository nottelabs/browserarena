import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

export class LightpandaProvider implements ProviderClient {
  readonly name = "LIGHTPANDA";
  private apiKey: string | null = null;
  private cdpUrl: string;

  computeCost(seconds: number): number {
    // Builder plan: $19/month for 300 hours (lightpanda.io/pricing).
    const perHour = 0.06;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  constructor() {
    this.cdpUrl = process.env.LIGHTPANDA_CDP_URL || "wss://uswest.cloud.lightpanda.io/ws";
  }

  private getApiKey(): string {
    if (!this.apiKey) {
      this.apiKey = requireEnv("LIGHTPANDA_API_KEY");
    }
    return this.apiKey;
  }

  // No session API: connecting to the CDP URL starts a session.
  async create(): Promise<ProviderSession> {
    // Built through URL so an endpoint override that already carries query
    // parameters keeps them. The cloud serves Lightpanda by default but also
    // serves Chrome, so pin the browser explicitly.
    const url = new URL(this.cdpUrl);
    url.searchParams.set("token", this.getApiKey());
    url.searchParams.set("browser", "lightpanda");
    return { id: "", cdpUrl: url.toString() };
  }

  // No release API: the runners end the session with browser.close().
  async release(_id: string): Promise<void> {}
}
