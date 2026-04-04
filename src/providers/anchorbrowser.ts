import type { ProviderClient, ProviderSession, RecordingResult } from "../types.js";
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

  async create(opts?: { recording?: boolean }): Promise<ProviderSession> {
    const createOpts = opts?.recording
      ? { session: { recording: { active: true } } }
      : {};
    const session = await (await this.client()).sessions.create(createOpts);
    const id = session.data?.id;
    const cdpUrl = session.data?.cdp_url;
    if (!id || !cdpUrl)
      throw new Error("Invalid Anchorbrowser session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await (await this.client()).sessions.delete(id);
  }

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const maxAttempts = 20;
    const delayMs = 3000;
    const client = await this.client();

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await (client.sessions.recordings as any).primary.get(sessionId);
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length > 0) return { data: buf, format: "mp4", extension: ".mp4" };
      } catch {
        // recording may still be processing
      }
      console.error(`[RECORDING] Anchor recording not ready yet, retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    throw new Error("Anchor Browser recording not available after max retries");
  }
}
