import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

// Tilion cloud browser provider for The Browser Arena.
// Lifecycle: create a session (the API returns an authenticated CDP url inline), connect
// Playwright, release. Non-stealth session to match how the other providers are benched.
export class TilionProvider implements ProviderClient {
  readonly name = "TILION";
  private base = (process.env.TILION_BASE_URL || "https://api.tilion.dev").replace(/\/+$/, "");

  // List price, $0.03/hr per session.
  computeCost(seconds: number): number {
    const perHour = 0.03;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  private headers() {
    return { Authorization: `Bearer ${requireEnv("TILION_API_KEY")}`, "Content-Type": "application/json" };
  }

  async create(): Promise<ProviderSession> {
    const r = await fetch(`${this.base}/v1/session`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ residential: false }),
    });
    if (!r.ok) throw new Error(`tilion create ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { session_id: string; connect_url?: string };
    let cdpUrl = j.connect_url || "";
    // the API may return ws://; the public endpoint is TLS, so upgrade to wss://.
    if (this.base.startsWith("https") && cdpUrl.startsWith("ws://")) cdpUrl = "wss://" + cdpUrl.slice(5);
    if (!j.session_id || !cdpUrl) throw new Error("tilion: no session_id/connect_url");
    return { id: j.session_id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    await fetch(`${this.base}/v1/session/${id}`, { method: "DELETE", headers: this.headers() }).catch(() => {});
  }
}
