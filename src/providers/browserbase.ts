import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { Browserbase } from "@browserbasehq/sdk";

export class BrowserbaseProvider implements ProviderClient {
  readonly name = "BROWSERBASE";
  private _client: Browserbase | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.12; // Developer. Startup is $0.10/hr. 1-min minimum.
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  private async client(): Promise<Browserbase | null> {
    if (!this._client) {
      const apiKey = requireEnv("BROWSERBASE_API_KEY");
      this._client = new Browserbase({ apiKey });
    }
    return this._client;
  }

  async create(): Promise<ProviderSession> {
    const projectId = requireEnv("BROWSERBASE_PROJECT_ID");
    const session = await (await this.client())?.sessions.create({ projectId, region: "us-east-1" });
    const id = session?.id;
    const cdpUrl = session?.connectUrl;
    if (!id || !cdpUrl) throw new Error("Invalid Browserbase session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const projectId = requireEnv("BROWSERBASE_PROJECT_ID");
    await (
      await this.client()
    )?.sessions.update(id, { status: "REQUEST_RELEASE", projectId });
  }
}
