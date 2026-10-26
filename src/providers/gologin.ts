import type { ProviderClient, ProviderSession, SessionOptions } from "../types.js";
import { requireEnv } from "../utils/env.js";

// GoLogin Cloud Browser provider for The Browser Arena.
// Lifecycle, following GoLogin's own SDK (gologin npm, launchCloudProfile):
//   create  → POST /browser/quick creates a fresh profile with a random fingerprint
//   connect → the CDP URL cloudbrowser.gologin.com/connect?token=…&profile=… starts it in the cloud
//   release → DELETE /browser/{id}/web stops the cloud browser, DELETE /browser/{id} removes the profile
// A fresh profile per session keeps concurrent runs from sharing one profile, which
// GoLogin can only run once at a time. Profile creation is therefore part of `create`.
export class GologinProvider implements ProviderClient {
  readonly name = "GOLOGIN";
  readonly proxyUnsupportedReason = "GoLogin proxy country targeting is not yet wired into this adapter";
  private api = (process.env.GOLOGIN_API_URL || "https://api.gologin.com").replace(/\/+$/, "");
  private cdpBase = process.env.GOLOGIN_CDP_URL || "wss://cloudbrowser.gologin.com/connect";

  // Custom plan rate, $0.04/hr (gologin.com/cloud-browser).
  computeCost(seconds: number): number {
    const perHour = 0.04;
    return Math.round((seconds / 3600) * perHour * 1e8) / 1e8;
  }

  private token(): string {
    return requireEnv("GOLOGIN_API_TOKEN");
  }

  private headers() {
    return { Authorization: `Bearer ${this.token()}`, "Content-Type": "application/json" };
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    if (opts?.proxyCountry) throw new Error(this.proxyUnsupportedReason);
    const r = await fetch(`${this.api}/browser/quick`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ os: "lin", name: "browserarena" }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`gologin create ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { id?: string };
    if (!j.id) throw new Error("gologin: no profile id in /browser/quick response");

    const url = new URL(this.cdpBase);
    url.searchParams.set("token", this.token());
    url.searchParams.set("profile", j.id);
    return { id: j.id, cdpUrl: url.toString(), configuration: { os: "lin", freshProfile: true } };
  }

  async release(id: string): Promise<void> {
    const stop = await fetch(`${this.api}/browser/${id}/web`, {
      method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(30_000),
    });
    if (!stop.ok && stop.status !== 404) {
      throw new Error(`gologin release ${stop.status}: ${await stop.text()}`);
    }
    // Remove the throwaway profile so repeated runs don't pile up in the account.
    const del = await fetch(`${this.api}/browser/${id}`, {
      method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(30_000),
    });
    if (!del.ok && del.status !== 404) {
      throw new Error(`gologin delete profile ${del.status}: ${await del.text()}`);
    }
  }
}
