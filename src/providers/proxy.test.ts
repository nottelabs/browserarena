import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import Browserbase from "@browserbasehq/sdk";
import Steel from "steel-sdk";
import { createAnchorbrowserClient } from "anchorbrowser";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { BrowserbaseProvider } from "./browserbase.js";
import { SteelProvider } from "./steel.js";
import { AnchorBrowserProvider } from "./anchorbrowser.js";
import { HyperbrowserProvider } from "./hyperbrowser.js";
import { KernelProvider } from "./kernel.js";
import { NotteProvider } from "./notte.js";
import { BrowserUseProvider } from "./browser-use.js";

test("native proxy adapters send documented country settings and Kernel deletes owned proxies", async () => {
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  let kernelCreateFails = false;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ path: req.url!, method: req.method!, body: body ? JSON.parse(body) : {} });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/browsers" && req.method === "POST" && kernelCreateFails) {
      res.writeHead(400); res.end(JSON.stringify({ message: "Invalid browser" })); return;
    }
    res.end(JSON.stringify({ id: "session-1", session_id: "session-1", cdp_ws_url: "ws://local",
      cdp_url: "ws://local", cdpUrl: "ws://local", connectUrl: "ws://local", websocketUrl: "ws://local?connect=1", wsEndpoint: "ws://local",
      data: { id: "session-1", cdp_url: "ws://local" } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const keys = ["BROWSERBASE_PROJECT_ID", "STEEL_API_KEY", "NOTTE_API_KEY", "NOTTE_API_URL", "KERNEL_API_KEY", "KERNEL_BASE_URL", "BROWSER_USE_API_KEY"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = "test";
  process.env.NOTTE_API_URL = origin;
  process.env.KERNEL_BASE_URL = origin;
  const originalFetch = globalThis.fetch;
  try {
    const browserbase = new BrowserbaseProvider();
    Object.assign(browserbase, { _client: new Browserbase({ apiKey: "test", baseURL: origin }) });
    await browserbase.create({ proxyCountry: "JP" });
    assert.deepEqual(requests.at(-1)!.body.proxies, [{ type: "browserbase", geolocation: { country: "JP" } }]);
    const steel = new SteelProvider();
    Object.assign(steel, { _client: new Steel({ steelAPIKey: "test", baseURL: origin }) });
    await steel.create({ proxyCountry: "BR" });
    assert.deepEqual(requests.at(-1)!.body.useProxy, { geolocation: { country: "BR" } });
    const anchor = new AnchorBrowserProvider();
    Object.assign(anchor, { _client: createAnchorbrowserClient({ auth: () => "test", baseUrl: origin }) });
    await anchor.create({ proxyCountry: "IN", recording: true });
    assert.deepEqual(requests.at(-1)!.body.browser, { adblock: { active: false }, popup_blocker: { active: false } });
    assert.deepEqual(requests.at(-1)!.body.session, { recording: { active: true }, proxy: { active: true, type: "anchor_proxy", country_code: "in" } });
    const hyper = new HyperbrowserProvider();
    Object.assign(hyper, { _client: new Hyperbrowser({ apiKey: "test", baseUrl: origin }) });
    await hyper.create({ proxyCountry: "FR" });
    assert.equal(requests.at(-1)!.body.proxyCountry, "FR");
    assert.equal(requests.at(-1)!.body.useProxy, true);
    const notte = new NotteProvider();
    const notteSession = await notte.create({ proxyCountry: "US" });
    assert.deepEqual(requests.at(-1)!.body.proxies, [{ type: "notte", country: "us" }]);
    assert.equal(requests.at(-1)!.body.block_ads, false);
    assert.deepEqual(notteSession.configuration, { proxy_country: "US", block_ads: false });
    await notte.create();
    assert.equal(requests.at(-1)!.body.proxies, false);
    assert.equal(requests.at(-1)!.body.block_ads, undefined, "lifecycle keeps provider defaults");
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      return originalFetch(url.startsWith("https://api.browser-use.com/") ? `${origin}/browser-use` : url, init);
    }) as typeof fetch;
    await new BrowserUseProvider().create({ proxyCountry: "BR" });
    assert.equal(requests.at(-1)!.body.proxyCountryCode, "br");
    globalThis.fetch = originalFetch;
    const kernel = new KernelProvider();
    const session = await kernel.create({ proxyCountry: "FR" });
    assert.match(String(requests.at(-2)!.body.name), /^browserarena-FR-[a-f0-9-]{36}$/);
    assert.equal(requests.at(-2)!.body.type, "residential");
    assert.deepEqual(requests.at(-2)!.body.config, { country: "FR" });
    assert.deepEqual(requests.at(-1)!.body.proxy, { id: "session-1" });
    await kernel.release(session.id);
    assert.deepEqual(requests.slice(-2).map(r => [r.method, r.path]), [["DELETE", "/browsers/session-1"], ["DELETE", "/proxies/session-1"]]);
    kernelCreateFails = true;
    await assert.rejects(() => kernel.create({ proxyCountry: "JP" }), /Invalid browser/);
    assert.equal(requests.at(-1)!.path, "/proxies/session-1");
    assert.equal(requests.at(-1)!.method, "DELETE");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
