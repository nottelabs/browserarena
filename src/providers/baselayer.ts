import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

type BaseLayerSessionResponse = {
  id?: string;
  sessionId?: string;
  cdpUrl?: string;
  connectUrl?: string;
  webSocketDebuggerUrl?: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export class BaseLayerProvider implements ProviderClient {
  readonly name = "BASELAYER";

  computeCost(): number {
    return 0;
  }

  private apiUrl(): string {
    return requireEnv("BASELAYER_API_URL").replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = optionalEnv("BASELAYER_API_KEY");
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private jsonHeaders(): Record<string, string> {
    return {
      ...this.authHeaders(),
      "Content-Type": "application/json",
    };
  }

  async create(): Promise<ProviderSession> {
    const runtimeProfile = optionalEnv("BASELAYER_RUNTIME_PROFILE");
    const body: Record<string, string> = { browser: "chromium" };
    if (runtimeProfile) body.runtimeProfile = runtimeProfile;

    const response = await fetch(`${this.apiUrl()}/v1/sessions`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new Error(`BaseLayer create failed: HTTP ${response.status} - ${await response.text()}`);
    }

    const data = (await response.json()) as BaseLayerSessionResponse;
    const id = data.id ?? data.sessionId;
    const cdpUrl = data.cdpUrl ?? data.connectUrl ?? data.webSocketDebuggerUrl;
    if (!id || !cdpUrl) {
      throw new Error(`Invalid BaseLayer session response: ${JSON.stringify(data)}`);
    }

    return { id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const response = await fetch(`${this.apiUrl()}/v1/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`BaseLayer release failed: HTTP ${response.status} - ${await response.text()}`);
    }
  }
}
