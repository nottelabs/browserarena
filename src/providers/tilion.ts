import type { ProviderClient, ProviderSession, SessionOptions } from "../types.js";
import { SessionCreationError } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { msSince, nowNs } from "../utils/time.js";

// Tilion cloud browser provider for The Browser Arena.
// Lifecycle: create a session (the API returns an authenticated CDP url inline), connect
// Playwright, release. Non-stealth session to match how the other providers are benched.
export class TilionProvider implements ProviderClient {
  readonly name = "TILION";
  // The 2026-10-11 pilot tried all five regions. Only US exit routing passed;
  // completed FR/BR/IN checks returned US, and JP sessions failed to launch.
  readonly proxyCountries = ["US"] as const;
  readonly proxyUnsupportedReason = "Tilion's residential US exit is verified; its region option did not verify residential exits in FR, BR, IN, or JP in the October 11 pilot";
  private base = (process.env.TILION_BASE_URL || "https://api.tilion.dev").replace(/\/+$/, "");

  // List price, $0.03/hr per session.
  computeCost(seconds: number): number {
    const perHour = 0.03;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  private headers() {
    return { Authorization: `Bearer ${requireEnv("TILION_API_KEY")}`, "Content-Type": "application/json" };
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    // Tilion exposes region + residential, rather than a separate proxy-country
    // field. Every benchmark attempt must still pass the independent exit check.
    const country = opts?.proxyCountry;
    if (country && country !== "US") throw new Error(this.proxyUnsupportedReason);
    const r = await fetch(`${this.base}/v1/session`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(country
        ? { residential: true, region: country.toLowerCase(), proxy_rotation: "per_session", idle_timeout: 90 }
        : { residential: false }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`tilion create ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { session_id: string; connect_url?: string; region?: string | null };
    let cdpUrl = j.connect_url || "";
    // the API may return ws://; the public endpoint is TLS, so upgrade to wss://.
    if (this.base.startsWith("https") && cdpUrl.startsWith("ws://")) cdpUrl = "wss://" + cdpUrl.slice(5);
    if (!j.session_id || !cdpUrl || (country && j.region !== country.toLowerCase())) {
      const reason = country && j.region !== country.toLowerCase()
        ? `tilion: requested region ${country.toLowerCase()}, returned ${j.region ?? "unknown"}`
        : "tilion: no session_id/connect_url";
      if (!j.session_id) throw new Error(reason);
      const releaseStart = nowNs();
      try { await this.release(j.session_id); }
      catch (error) {
        throw new SessionCreationError(reason, j.session_id,
          error instanceof Error ? error.message : String(error), null);
      }
      throw new SessionCreationError(reason, j.session_id, null, msSince(releaseStart));
    }
    return { id: j.session_id, cdpUrl };
  }

  async release(id: string): Promise<void> {
    const r = await fetch(`${this.base}/v1/session/${id}`, {
      method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok && r.status !== 404) throw new Error(`tilion release ${r.status}: ${await r.text()}`);
  }
}
