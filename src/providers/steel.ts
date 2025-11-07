import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";
import Steel from "steel-sdk";

export class SteelProvider implements ProviderClient {
  readonly name = "STEEL";
  private _client: Steel | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.1; // Hobby/Starter. Developer $0.08/hr, Pro $0.05/hr. Billed by minute, rounded up.
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  private async client(): Promise<Steel> {
    if (!this._client) {
      const apiKey = requireEnv("STEEL_API_KEY");
      this._client = new Steel({ steelAPIKey: apiKey });
    }
    return this._client;
  }

  async create(): Promise<ProviderSession> {
    const apiKey = requireEnv("STEEL_API_KEY");
    const session = await (await this.client()).sessions.create();
    const id = session?.id;
    const websocketUrl = session?.websocketUrl;
    const cdpUrl = `${websocketUrl}&apiKey=${apiKey}`;
    if (!id || !cdpUrl) throw new Error("Invalid Steel session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await this.client()).sessions.release(id);
  }
}
