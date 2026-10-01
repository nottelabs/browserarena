import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { BrowserlessProvider } from "./browserless.js";

const originalApiKey = process.env.BROWSERLESS_API_KEY;
const originalCdpUrl = process.env.BROWSERLESS_CDP_URL;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.BROWSERLESS_API_KEY = "test-token";
  delete process.env.BROWSERLESS_CDP_URL;
});

afterEach(() => {
  restore("BROWSERLESS_API_KEY", originalApiKey);
  restore("BROWSERLESS_CDP_URL", originalCdpUrl);
});

test("connects to the US West fleet with the token in the URL", async () => {
  const provider = new BrowserlessProvider();
  const session = await provider.create();

  const url = new URL(session.cdpUrl);
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "production-sfo.browserless.io");
  assert.equal(url.searchParams.get("token"), "test-token");

  // There is no session API: the id stays empty, nothing travels as a header,
  // and the runners release the session by closing the browser.
  assert.equal(session.id, "");
  assert.equal(session.headers, undefined);
  assert.equal(provider.releasesOnDisconnect, true);
});

test("an endpoint override keeps its own query parameters", async () => {
  process.env.BROWSERLESS_CDP_URL = "wss://production-lon.browserless.io/chromium?blockAds=true";

  const { cdpUrl } = await new BrowserlessProvider().create();

  const url = new URL(cdpUrl);
  assert.equal(url.host, "production-lon.browserless.io");
  assert.equal(url.pathname, "/chromium");
  assert.equal(url.searchParams.get("blockAds"), "true");
  assert.equal(url.searchParams.get("token"), "test-token");
});

test("a missing API key fails on create, not on construction", async () => {
  delete process.env.BROWSERLESS_API_KEY;

  const provider = new BrowserlessProvider();
  await assert.rejects(() => provider.create(), /BROWSERLESS_API_KEY/);
});

test("releasing is a no-op and cost is billed in 30-second units", async () => {
  const provider = new BrowserlessProvider();

  await provider.release("");

  // $25 for 20,000 units: every started 30 seconds costs $0.00125.
  assert.equal(provider.computeCost(0), 0.00125);
  assert.equal(provider.computeCost(30), 0.00125);
  assert.equal(provider.computeCost(31), 0.0025);
  assert.equal(provider.computeCost(3600), 0.15);
});
