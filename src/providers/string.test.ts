import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { StringProvider } from "./string.js";

const originalApiKey = process.env.STRING_API_KEY;
const originalCdpUrl = process.env.STRING_CDP_URL;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.STRING_API_KEY = "test-key";
  delete process.env.STRING_CDP_URL;
});

afterEach(() => {
  restore("STRING_API_KEY", originalApiKey);
  restore("STRING_CDP_URL", originalCdpUrl);
});

test("connects to the public endpoint with the key in a header, never the URL", async () => {
  const provider = new StringProvider();
  const session = await provider.create();

  const url = new URL(session.cdpUrl);
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "request.usestring.ai");
  assert.equal(url.pathname, "/v1/wss");
  assert.equal(session.headers?.Authorization, "Bearer test-key");
  assert.ok(!session.cdpUrl.includes("test-key"));

  // There is no session API: the id stays empty and the runners release the
  // session by closing the browser.
  assert.equal(session.id, "");
  assert.equal(provider.releasesOnDisconnect, true);
});

test("an unproxied session asks for the standard tier and no country", async () => {
  const session = await new StringProvider().create();
  const url = new URL(session.cdpUrl);
  assert.equal(url.searchParams.get("proxy"), "standard");
  assert.equal(url.searchParams.get("countryCode"), null);
  assert.deepEqual(session.configuration, { proxy: "standard" });
});

test("a proxied session asks for a residential exit in the requested country", async () => {
  const session = await new StringProvider().create({ proxyCountry: "FR" });
  const url = new URL(session.cdpUrl);
  assert.equal(url.searchParams.get("proxy"), "premium");
  assert.equal(url.searchParams.get("countryCode"), "FR");
  assert.deepEqual(session.configuration, { proxy: "premium", countryCode: "FR" });
});

test("an endpoint override keeps its own query parameters", async () => {
  process.env.STRING_CDP_URL = "ws://localhost:7654/v1/wss?record=true";

  const { cdpUrl } = await new StringProvider().create();

  const url = new URL(cdpUrl);
  assert.equal(url.host, "localhost:7654");
  assert.equal(url.searchParams.get("record"), "true");
  assert.equal(url.searchParams.get("proxy"), "standard");
});

test("a missing API key fails on create, not on construction", async () => {
  delete process.env.STRING_API_KEY;

  const provider = new StringProvider();
  await assert.rejects(() => provider.create(), /STRING_API_KEY/);
});

test("releasing is a no-op and session time is billed at $0.12 an hour", async () => {
  const provider = new StringProvider();

  await provider.release("");

  assert.equal(provider.computeCost(0), 0);
  assert.equal(provider.computeCost(30), 0.001);
  assert.equal(provider.computeCost(3600), 0.12);
});
