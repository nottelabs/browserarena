import type { ProviderClient, ProviderSession, RecordingResult } from "../types.js";
import { requireEnv } from "../utils/env.js";

export class BrowserUseProvider implements ProviderClient {
  readonly name = "BROWSER_USE";

  computeCost(seconds: number): number {
    const perHour = 0.06;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  async create(): Promise<ProviderSession> {
    const apiKey = requireEnv("BROWSER_USE_API_KEY");
    const res = await fetch("https://api.browser-use.com/api/v2/browsers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Browser-Use-API-Key": apiKey,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Browser Use create failed: HTTP ${res.status} - ${body}`);
    }
    const data = await res.json();
    const id = data.id;
    const cdpUrl = data.cdpUrl;
    if (!id || !cdpUrl) throw new Error("Invalid Browser Use response: missing id or cdpUrl");
    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const apiKey = requireEnv("BROWSER_USE_API_KEY");
    const res = await fetch(`https://api.browser-use.com/api/v2/browsers/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Browser-Use-API-Key": apiKey,
      },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Browser Use stop failed: HTTP ${res.status} - ${body}`);
    }
  }

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const apiKey = requireEnv("BROWSER_USE_API_KEY");
    const maxAttempts = 30;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(`https://api.browser-use.com/api/v2/sessions/${sessionId}`, {
        headers: { "X-Browser-Use-API-Key": apiKey },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(`Browser Use session fetch failed: HTTP ${res.status}`);
      }

      const session = await res.json();
      if (session.recordingUrl) {
        const mp4Res = await fetch(session.recordingUrl, { signal: AbortSignal.timeout(120_000) });
        if (!mp4Res.ok) throw new Error(`Failed to download Browser Use recording: HTTP ${mp4Res.status}`);
        const buf = Buffer.from(await mp4Res.arrayBuffer());
        return { data: buf, format: "mp4", extension: ".mp4" };
      }

      if (session.status === "stopped" && !session.recordingUrl) {
        if (i < maxAttempts - 1) {
          console.error(`[RECORDING] Browser Use recording not ready yet, retrying in ${delayMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error("Browser Use recordingUrl not available after session stopped");
      }

      console.error(`[RECORDING] Browser Use session status=${session.status}, retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    throw new Error("Browser Use recording not available after max retries");
  }
}
