import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { LightpandaProvider } from "./lightpanda.js";

const originalApiKey = process.env.LIGHTPANDA_API_KEY;
const originalCdpUrl = process.env.LIGHTPANDA_CDP_URL;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.LIGHTPANDA_API_KEY = "test-token";
  delete process.env.LIGHTPANDA_CDP_URL;
});

afterEach(() => {
  restore("LIGHTPANDA_API_KEY", originalApiKey);
  restore("LIGHTPANDA_CDP_URL", originalCdpUrl);
});

test("connects to the us-west endpoint with the token and browser pinned", async () => {
  const session = await new LightpandaProvider().create();

  const url = new URL(session.cdpUrl);
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "uswest.cloud.lightpanda.io");
  assert.equal(url.pathname, "/ws");
  assert.equal(url.searchParams.get("token"), "test-token");
  assert.equal(url.searchParams.get("browser"), "lightpanda");

  // There is no session API: the id stays empty and the runners release the
  // session by closing the browser.
  assert.equal(session.id, "");
});

test("an endpoint override keeps its own query parameters", async () => {
  process.env.LIGHTPANDA_CDP_URL = "wss://euwest.cloud.lightpanda.io/ws?proxy=eu";

  const { cdpUrl } = await new LightpandaProvider().create();

  const url = new URL(cdpUrl);
  assert.equal(url.host, "euwest.cloud.lightpanda.io");
  assert.equal(url.searchParams.get("proxy"), "eu");
  assert.equal(url.searchParams.get("token"), "test-token");
  assert.equal(url.searchParams.get("browser"), "lightpanda");
});

test("a missing API key fails on create, not on construction", async () => {
  delete process.env.LIGHTPANDA_API_KEY;

  const provider = new LightpandaProvider();
  await assert.rejects(() => provider.create(), /LIGHTPANDA_API_KEY/);
});

test("releasing is a no-op and cost follows the hourly rate", async () => {
  const provider = new LightpandaProvider();

  await provider.release("");

  // $0.08/hr, billed per second with no minimum.
  assert.equal(provider.computeCost(3600), 0.08);
  assert.equal(provider.computeCost(90), 0.002);
  assert.equal(provider.computeCost(0), 0);
});
