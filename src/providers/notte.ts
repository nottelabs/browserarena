import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

interface SessionResponse {
  session_id: string;
  status: string;
  created_at: string;
  last_accessed_at: string;
  cdp_url?: string;
}

export class NotteProvider implements ProviderClient {
  readonly name = "NOTTE";
  private apiKey: string | null = null;

  computeCost(seconds: number): number {
    const perHour = 0.05;
    const billedSeconds = Math.max(60, Math.ceil(seconds / 60) * 60);
    return Math.round((billedSeconds / 3600) * perHour * 1e8) / 1e8;
  }
  private baseUrl: string;

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
    // Start a new session with default parameters
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
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const isHtml = errorText.trim().startsWith('<!DOCTYPE') || errorText.trim().startsWith('<html');
      const errorBody = isHtml ? response.statusText : errorText;
      throw new Error(`Failed to stop Notte session: HTTP ${response.status} - ${errorBody}`);
    }
  }
}
