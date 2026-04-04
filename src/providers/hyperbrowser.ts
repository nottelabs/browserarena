import type { ProviderClient, ProviderSession, RecordingResult } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { Hyperbrowser } from "@hyperbrowser/sdk";

export class HyperbrowserProvider implements ProviderClient {
  readonly name = "HYPERBROWSER";
  private _client: Hyperbrowser | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.1;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  private async client(): Promise<Hyperbrowser> {
    if (!this._client) {
      const apiKey = requireEnv("HYPERBROWSER_API_KEY");
      this._client = new Hyperbrowser({ apiKey });
    }
    return this._client;
  }

  async create(opts?: { recording?: boolean }): Promise<ProviderSession> {
    const createOpts: Record<string, unknown> = { region: "us-east" };
    if (opts?.recording) {
      createOpts.enableVideoWebRecording = true;
    }
    const session = await (await this.client()).sessions.create(createOpts as any);
    const id = session.id;
    const cdpUrl = session.wsEndpoint;
    if (!id || !cdpUrl)
      throw new Error("Invalid Hyperbrowser session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await this.client()).sessions.stop(id);
  }

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const client = await this.client();
    const maxAttempts = 30;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      const result = await client.sessions.getVideoRecordingURL(sessionId);
      const status = (result as any).status;
      const url = (result as any).recordingUrl;

      if (status === "completed" && url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`Failed to download Hyperbrowser video: HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        return { data: buf, format: "mp4", extension: ".mp4" };
      }

      if (status === "failed") throw new Error("Hyperbrowser video recording failed");
      if (status === "not_enabled") throw new Error("Hyperbrowser video recording not enabled for this session");

      console.error(`[RECORDING] Hyperbrowser recording status=${status}, retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    throw new Error("Hyperbrowser video recording not available after max retries");
  }
}
