// CAPTCHA presets deliberately differ from lifecycle presets: native solvers and proxies, no SDK retries.
export function createProviders(load, env = process.env, request = fetch) {
  async function api(url, method, headers, body, signal = AbortSignal.timeout(60_000)) {
    const response = await request(url, { method, headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`Provider request failed: HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return async function create(provider) {
    if (provider === "browserbase") {
      const { Browserbase } = load("@browserbasehq/sdk");
      const client = new Browserbase({ apiKey: env.BROWSERBASE_API_KEY, maxRetries: 0, timeout: 60_000 });
      const data = await client.sessions.create({ projectId: env.BROWSERBASE_PROJECT_ID, region: "us-east-1",
        proxies: true, timeout: 300, browserSettings: { solveCaptchas: true, blockAds: false } });
      return { id: data.id, cdpUrl: data.connectUrl,
        configuration: { solveCaptchas: true, proxy: true, region: "us-east-1" },
        release: () => client.sessions.update(data.id, { status: "REQUEST_RELEASE", projectId: env.BROWSERBASE_PROJECT_ID }, { maxRetries: 0, timeout: 30_000 }) };
    }
    if (provider === "steel") {
      const { default: Steel } = load("steel-sdk");
      const client = new Steel({ steelAPIKey: env.STEEL_API_KEY, maxRetries: 0, timeout: 60_000 });
      const data = await client.sessions.create({ solveCaptcha: true, useProxy: true, sessionTimeout: 300_000 });
      return { id: data.id, cdpUrl: data.websocketUrl ? `${data.websocketUrl}&apiKey=${env.STEEL_API_KEY}` : undefined,
        configuration: { solveCaptcha: true, proxy: true },
        release: () => client.sessions.release(data.id, {}, { maxRetries: 0, timeout: 30_000 }),
        diagnostics: () => client.sessions.captchas.status(data.id, { maxRetries: 0, timeout: 15_000 }) };
    }
    if (provider === "kernel") {
      const { default: Kernel } = load("@onkernel/sdk");
      const client = new Kernel({ apiKey: env.KERNEL_API_KEY, maxRetries: 0, timeout: 60_000 });
      const data = await client.browsers.create({ stealth: true, headless: true, timeout_seconds: 300 });
      return { id: data.session_id, cdpUrl: data.cdp_ws_url,
        configuration: { stealth: true, headless: true, proxy: "stealth ISP default" },
        release: () => client.browsers.deleteByID(data.session_id, { maxRetries: 0, timeout: 30_000 }) };
    }
    if (provider === "browser-use") {
      const base = "https://api.browser-use.com/api/v4/browsers";
      const headers = { "X-Browser-Use-API-Key": env.BROWSER_USE_API_KEY };
      const data = await api(base, "POST", headers, { proxyCountryCode: "us", timeout: 5, enableRecording: false });
      return { id: data.id, cdpUrl: data.cdpUrl?.replace("https://", "wss://"),
        configuration: { solver: "provider default", proxy: "US", api: "v4" },
        release: () => api(`${base}/${data.id}`, "PATCH", headers, { action: "stop" }, AbortSignal.timeout(30_000)) };
    }
    if (provider === "notte") {
      const base = "https://api.notte.cc";
      const headers = { Authorization: `Bearer ${env.NOTTE_API_KEY}` };
      const data = await api(`${base}/sessions/start`, "POST", headers, {
        browser_type: "chrome", headless: true, proxies: [{ type: "notte", country: "us" }],
        solve_captchas: true, max_duration_minutes: 5, block_ads: false,
      });
      return { id: data.session_id, cdpUrl: data.cdp_url,
        configuration: { browser_type: "chrome", headless: true, solve_captchas: true, proxy: "US", block_ads: false, api: base },
        release: () => api(`${base}/sessions/${data.session_id}/stop`, "DELETE", headers, undefined, AbortSignal.timeout(30_000)) };
    }
    throw new Error(`Unsupported provider: ${provider}`);
  };
}

export const REQUIRED_ENV = {
  kernel: ["KERNEL_API_KEY"], browserbase: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
  "browser-use": ["BROWSER_USE_API_KEY"], steel: ["STEEL_API_KEY"], notte: ["NOTTE_API_KEY"],
};
