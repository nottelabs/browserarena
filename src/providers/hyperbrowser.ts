import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { Hyperbrowser } from "@hyperbrowser/sdk";

export class HyperbrowserProvider implements ProviderClient {
  readonly name = "HYPERBROWSER";
  private _client: Hyperbrowser | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.1; // Billed per second, no minimum.
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  private async client(): Promise<Hyperbrowser> {
    if (!this._client) {
      const apiKey = requireEnv("HYPERBROWSER_API_KEY");
      this._client = new Hyperbrowser({ apiKey });
    }
    return this._client;
  }

  async create(): Promise<ProviderSession> {
    const session = await (await this.client()).sessions.create({ region: "us-east" });
    const id = session.id;
    const cdpUrl = session.wsEndpoint;
    if (!id || !cdpUrl)
      throw new Error("Invalid Hyperbrowser session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await this.client()).sessions.stop(id);
  }
}
