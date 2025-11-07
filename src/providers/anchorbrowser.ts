import type { ProviderClient, ProviderSession } from "../types.js";
import Anchorbrowser from "anchorbrowser";
import { requireEnv } from "../utils/env.js";

export class AnchorBrowserProvider implements ProviderClient {
  readonly name = "ANCHORBROWSER";
  private _client: Anchorbrowser | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.05;
    const creationCost = 0.01;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    const usageCost = (billedSeconds / 3600) * perHour;
    return Math.round((creationCost + usageCost) * 1e8) / 1e8;
  }

  private async client(): Promise<Anchorbrowser> {
    if (!this._client) {
      const apiKey = requireEnv("ANCHORBROWSER_API_KEY");
      this._client = new Anchorbrowser({ apiKey });
    }
    return this._client;
  }

  async create(): Promise<ProviderSession> {
    const session = await (await this.client()).sessions.create();
    const id = session.data?.id;
    const cdpUrl = session.data?.cdp_url;
    if (!id || !cdpUrl)
      throw new Error("Invalid Anchorbrowser session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await this.client()).sessions.delete(id);
  }
}
