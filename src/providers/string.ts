import type { ProviderClient, ProviderSession, SessionOptions } from "../types.js";
import { PROXY_COUNTRIES } from "../benchmarks/proxy-get/schema.js";
import { requireEnv } from "../utils/env.js";

export class StringProvider implements ProviderClient {
  readonly name = "STRING";
  // Residential (`premium`) exits, targeted by ISO country code on the connect URL
  // (portal.usestring.ai/docs).
  readonly proxyCountries = PROXY_COUNTRIES;
  readonly releasesOnDisconnect = true;
  private cdpUrl: string;

  computeCost(seconds: number): number {
    // $0.12 per hour of session time on every plan, metered continuously with
    // no minimum (usestring.ai/pricing). Bandwidth is billed per GiB on top
    // ($5 standard, $10 premium) and is not part of this estimate.
    return Math.round((seconds / 3600) * 0.12 * 1e8) / 1e8;
  }

  constructor() {
    this.cdpUrl = process.env.STRING_CDP_URL || "wss://request.usestring.ai/v1/wss";
  }

  // No session API call: connecting to the CDP URL starts a browser, and
  // closing the connection ends it. The key travels as a header so it never
  // appears in a URL that might be logged.
  async create(opts?: SessionOptions): Promise<ProviderSession> {
    const apiKey = requireEnv("STRING_API_KEY");
    const url = new URL(this.cdpUrl);
    // Every String session egresses through a proxy; there is no direct
    // option. `standard` (String's own ISP exits) is the closest to the
    // proxy-free sessions the other providers are benchmarked with.
    const proxy = opts?.proxyCountry ? "premium" : "standard";
    url.searchParams.set("proxy", proxy);
    if (opts?.proxyCountry) url.searchParams.set("countryCode", opts.proxyCountry);
    return {
      id: "",
      cdpUrl: url.toString(),
      headers: { Authorization: `Bearer ${apiKey}` },
      configuration: { proxy, ...(opts?.proxyCountry && { countryCode: opts.proxyCountry }) },
    };
  }

  // No release API: the runners end the session with browser.close().
  async release(_id: string): Promise<void> {}
}
