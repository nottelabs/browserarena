import type { ProviderClient, ProviderSession, RecordingResult } from "../types.js";
import { requireEnv } from "../utils/env.js";

interface SessionResponse {
  session_id: string;
  status: string;
  created_at: string;
  last_accessed_at: string;
  cdp_url?: string;
}

interface ReplayResponse {
  mp4_url: string | null;
  playlist_content: string | null;
  expires_at: string;
  video_start_ms: number | null;
  video_duration_ms: number | null;
}

export class NotteProvider implements ProviderClient {
  readonly name = "NOTTE";
  private apiKey: string | null = null;
  private baseUrl: string;

  computeCost(seconds: number): number {
    const perHour = 0.05;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }

  constructor() {
    this.baseUrl = process.env.NOTTE_API_URL || "https://api.notte.cc";
  }

  private getApiKey(): string {
    if (!this.apiKey) {
      this.apiKey = requireEnv("NOTTE_API_KEY");
    }
    return this.apiKey;
  }

  async create(): Promise<ProviderSession> {
    const startResponse = await fetch(`${this.baseUrl}/sessions/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.getApiKey()}`,
      },
      body: JSON.stringify({}),
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      const isHtml = errorText.trim().startsWith('<!DOCTYPE') || errorText.trim().startsWith('<html');
      const errorBody = isHtml ? startResponse.statusText : errorText;
      throw new Error(`Failed to start Notte session: HTTP ${startResponse.status} - ${errorBody}`);
    }

    const sessionData: SessionResponse = await startResponse.json();
    const sessionId = sessionData.session_id;

    if (!sessionId) {
      throw new Error("Invalid Notte session response: missing session_id");
    }

    const cdpUrl = sessionData.cdp_url;
    if (!cdpUrl) {
      throw new Error("Invalid Notte session response: missing cdp_url");
    }

    return { id: sessionId, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${id}/stop`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${this.getApiKey()}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const isHtml = errorText.trim().startsWith('<!DOCTYPE') || errorText.trim().startsWith('<html');
      const errorBody = isHtml ? response.statusText : errorText;
      throw new Error(`Failed to stop Notte session: HTTP ${response.status} - ${errorBody}`);
    }
  }

  async downloadRecording(sessionId: string): Promise<RecordingResult> {
    const maxAttempts = 20;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/replay`, {
        headers: { "Authorization": `Bearer ${this.getApiKey()}` },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(`Notte replay fetch failed: HTTP ${res.status} - ${await res.text()}`);
      }

      const contentType = res.headers.get("content-type") ?? "";

      // API may return MP4 directly or JSON with mp4_url
      if (contentType.includes("video/") || contentType.includes("octet-stream")) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) return { data: buf, format: "mp4", extension: ".mp4" };
        if (i < maxAttempts - 1) {
          console.error(`[RECORDING] Notte replay empty, retrying in ${delayMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error("Notte replay returned empty video");
      }

      const replay: ReplayResponse = await res.json();
      if (!replay.mp4_url) {
        if (i < maxAttempts - 1) {
          console.error(`[RECORDING] Notte replay not ready yet, retrying in ${delayMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error("Notte replay mp4_url not available after polling");
      }

      const mp4Res = await fetch(replay.mp4_url, { signal: AbortSignal.timeout(120_000) });
      if (!mp4Res.ok) throw new Error(`Failed to download Notte MP4: HTTP ${mp4Res.status}`);
      const buf = Buffer.from(await mp4Res.arrayBuffer());
      return { data: buf, format: "mp4", extension: ".mp4" };
    }

    throw new Error("Notte replay not available after max retries");
  }
}
