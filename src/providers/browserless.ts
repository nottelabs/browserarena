import type { ProviderClient, ProviderSession } from "../types.js";
import { requireEnv } from "../utils/env.js";

export class BrowserlessProvider implements ProviderClient {
  readonly name = "BROWSERLESS";
  readonly releasesOnDisconnect = true;
  private cdpUrl: string;

  computeCost(seconds: number): number {
    // Prototyping plan: $25/month, billed annually, for 20,000 units
    // (browserless.io/pricing).
    // A unit is 30 seconds of an open session, rounded up.
    const perUnit = 25 / 20_000;
    const units = Math.max(1, Math.ceil(seconds / 30));
    return Math.round(units * perUnit * 1e8) / 1e8;
  }

  constructor() {
    // The shared fleet has no US East region; SFO is the only US one.
    this.cdpUrl = process.env.BROWSERLESS_CDP_URL || "wss://production-sfo.browserless.io";
  }

  // No session API call: connecting to the CDP URL starts a browser. Browserless
  // does have a session API, but it only reserves persistent state and still
  // launches the browser on connect.
  async create(): Promise<ProviderSession> {
    const url = new URL(this.cdpUrl);
    url.searchParams.set("token", requireEnv("BROWSERLESS_API_KEY"));
    return { id: "", cdpUrl: url.toString() };
  }

  // No release API: the runners end the session with browser.close().
  async release(_id: string): Promise<void> {}
}
