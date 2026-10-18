import type { ProviderClient, ProviderSession, RecordingResult, SessionOptions } from "../types.js";
import { PROXY_COUNTRIES } from "../benchmarks/proxy-get/schema.js";
import { createAnchorbrowserClient, Recordings, Sessions, type Client, type SessionCreateRequestSchema } from "anchorbrowser";
import { requireEnv } from "../utils/env.js";

export class AnchorBrowserProvider implements ProviderClient {
  readonly name = "ANCHORBROWSER";
  readonly proxyCountries = PROXY_COUNTRIES;
  private _client: Client | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.05;
    const creationCost = 0.01;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    const usageCost = (billedSeconds / 3600) * perHour;
    return Math.round((creationCost + usageCost) * 1e8) / 1e8;
  }

  private async client(): Promise<Client> {
    if (!this._client) {
      const apiKey = requireEnv("ANCHORBROWSER_API_KEY");
      this._client = createAnchorbrowserClient({ auth: () => apiKey });
    }
    return this._client;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    const createOpts: SessionCreateRequestSchema = {
      ...(opts?.proxyCountry ? { browser: { adblock: { active: false }, popup_blocker: { active: false } } } : {}),
      session: {
      ...(opts?.recording ? { recording: { active: true } } : {}),
      ...(opts?.proxyCountry ? { proxy: { active: true, type: "anchor_proxy" as const,
        country_code: opts.proxyCountry.toLowerCase() as "us" | "fr" | "br" | "in" | "jp" } } : {}),
    } };
    const session = await Sessions.createSession({
      client: await this.client(),
      body: createOpts,
      // The v1 SDK uses AbortSignal for timeouts and does not retry requests.
      signal: AbortSignal.timeout(opts?.proxyCountry ? 90_000 : 600_000),
    });
    const id = session.data?.id;
    const cdpUrl = session.data?.cdp_url;
    if (!id || !cdpUrl)
      throw new Error("Invalid Anchorbrowser session response");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await Sessions.deleteSession({
      client: await this.client(),
      path: { session_id: id },
      signal: AbortSignal.timeout(600_000),
    });
  }

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const maxAttempts = 20;
    const delayMs = 3000;
    const client = await this.client();

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await Recordings.fetchPrimaryRecording({
          client,
          path: { session_id: sessionId },
          parseAs: "blob",
          signal: AbortSignal.timeout(600_000),
        });
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
