import assert from "node:assert/strict";
import { test } from "node:test";

import { NotteProvider } from "./notte.js";

test("cost follows the $0.01/hr rate, billed per minute with a one-minute minimum", () => {
  const provider = new NotteProvider();

  assert.equal(provider.computeCost(3600), 0.01);
  // Anything under a minute bills as one minute.
  assert.equal(provider.computeCost(0), 0.00016667);
  assert.equal(provider.computeCost(10), 0.00016667);
  assert.equal(provider.computeCost(60), 0.00016667);
  // Past the first minute, time rounds up to the next whole minute.
  assert.equal(provider.computeCost(61), 0.00033333);
  assert.equal(provider.computeCost(90), 0.00033333);
});

test("notte-staging targets us-staging.notte.cc with its own key", async (t) => {
  const { resolveProvider, getRequiredEnvVarsForProvider } = await import("./index.js");
  const saved = { key: process.env.NOTTE_STAGING_API_KEY, url: process.env.NOTTE_STAGING_API_URL, prod: process.env.NOTTE_API_KEY };
  process.env.NOTTE_STAGING_API_KEY = "staging-key";
  delete process.env.NOTTE_STAGING_API_URL;
  process.env.NOTTE_API_KEY = "prod-key";
  const calls: { url: string; auth: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({ session_id: "s1", status: "active", cdp_url: "wss://cdp" }), { status: 200 });
  });
  t.after(() => {
    for (const [name, value] of [["NOTTE_STAGING_API_KEY", saved.key], ["NOTTE_STAGING_API_URL", saved.url], ["NOTTE_API_KEY", saved.prod]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  assert.deepEqual(getRequiredEnvVarsForProvider("notte-staging"), ["NOTTE_STAGING_API_KEY"]);
  const provider = resolveProvider("notte-staging");
  assert.equal(provider.name, "NOTTE_STAGING");
  await provider.create();
  assert.deepEqual(calls, [{ url: "https://us-staging.notte.cc/sessions/start", auth: "Bearer staging-key" }]);
  assert.equal(resolveProvider("notte").name, "NOTTE");
});
