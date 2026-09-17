import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

export class LightpandaProvider implements ProviderClient {
  readonly name = "LIGHTPANDA";
  private apiKey: string | null = null;
  private cdpUrl: string;

  computeCost(seconds: number): number {
    // Builder plan overage rate (lightpanda.io/pricing).
    const perHour = 0.08;
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
    return { id: "", cdpUrl: `${this.cdpUrl}?token=${this.getApiKey()}&browser=lightpanda` };
  }

  // No release API: the runners end the session with browser.close().
  async release(_id: string): Promise<void> {}
}
