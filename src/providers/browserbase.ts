import type { ProviderClient, ProviderSession, RecordingResult, SessionOptions } from "../types.js";
import { PROXY_COUNTRIES } from "../benchmarks/proxy-get/schema.js";
import { requireEnv } from "../utils/env.js";
import { Browserbase } from "@browserbasehq/sdk";

export class BrowserbaseProvider implements ProviderClient {
  readonly name = "BROWSERBASE";
  readonly proxyCountries = PROXY_COUNTRIES;
  private _client: Browserbase | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.12;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  private async client(): Promise<Browserbase> {
    if (!this._client) {
      const apiKey = requireEnv("BROWSERBASE_API_KEY");
      this._client = new Browserbase({ apiKey });
    }
    return this._client;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    const projectId = requireEnv("BROWSERBASE_PROJECT_ID");
    const session = await (await this.client()).sessions.create({ projectId, region: "us-east-1",
      ...(opts?.proxyCountry ? { proxies: [{ type: "browserbase" as const, geolocation: { country: opts.proxyCountry } }] } : {}),
    }, opts?.proxyCountry ? { maxRetries: 0, timeout: 90_000 } : undefined);
    const id = session?.id;
    const cdpUrl = session?.connectUrl;
    if (!id || !cdpUrl) throw new Error("Invalid Browserbase session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const projectId = requireEnv("BROWSERBASE_PROJECT_ID");
    await (await this.client()).sessions.update(id, { status: "REQUEST_RELEASE", projectId });
  }

  async getProxyBytes(id: string): Promise<number | null> {
    return (await (await this.client()).sessions.retrieve(id, { maxRetries: 0, timeout: 30_000 })).proxyBytes ?? null;
  }

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const bb = await this.client();
    const recording = await bb.sessions.recording.retrieve(sessionId);
    const json = JSON.stringify({
      dashboardUrl: `https://browserbase.com/sessions/${sessionId}`,
      events: recording,
    }, null, 2);
    return { data: Buffer.from(json, "utf-8"), format: "json", extension: ".rrweb.json" };
  }
}
