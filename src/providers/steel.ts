import type { ProviderClient, ProviderSession, RecordingResult } from "../types.js";
import { requireEnv } from "../utils/env.js";
import Steel from "steel-sdk";

export class SteelProvider implements ProviderClient {
  readonly name = "STEEL";
  private _client: Steel | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.1;
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

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const apiKey = requireEnv("STEEL_API_KEY");
    const hlsUrl = `https://api.steel.dev/v1/sessions/${sessionId}/hls`;
    const res = await fetch(hlsUrl, {
      headers: { "steel-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Steel HLS fetch failed: HTTP ${res.status} - ${await res.text()}`);
    }
    const manifest = await res.text();
    return { data: Buffer.from(manifest, "utf-8"), format: "m3u8", extension: ".m3u8" };
  }
}
