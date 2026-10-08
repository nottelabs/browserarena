import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { CloudflareProvider } from "./cloudflare.js";

const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const originalApiToken = process.env.CLOUDFLARE_API_TOKEN;
const originalFetch = globalThis.fetch;

const BASE = "https://api.cloudflare.com/client/v4/accounts/acct-1/browser-rendering/devtools/browser";
const WS_URL = "wss://api.cloudflare.com/client/v4/accounts/acct-1/browser-rendering/devtools/browser/sess-1";

type Call = { url: string; method?: string; authorization: string | null };

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Replaces fetch with one canned response and records the request. */
function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-1";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
});

afterEach(() => {
  restore("CLOUDFLARE_ACCOUNT_ID", originalAccountId);
  restore("CLOUDFLARE_API_TOKEN", originalApiToken);
  globalThis.fetch = originalFetch;
});

test("creates a session and hands the bearer token to the CDP connect", async () => {
  const calls = stubFetch(200, { sessionId: "sess-1", webSocketDebuggerUrl: WS_URL });

  const session = await new CloudflareProvider().create();

  assert.deepEqual(calls, [{ url: BASE, method: "POST", authorization: "Bearer test-token" }]);
  assert.equal(session.id, "sess-1");
  assert.equal(session.cdpUrl, WS_URL);

  // The websocket has no URL credential, so the token must reach Playwright.
  assert.deepEqual(session.headers, { Authorization: "Bearer test-token" });
});

test("a response without a websocket URL connects to the session endpoint", async () => {
  stubFetch(200, { sessionId: "sess-1" });

  const session = await new CloudflareProvider().create();

  assert.equal(session.id, "sess-1");
  assert.equal(session.cdpUrl, WS_URL);
});

test("a rejected create surfaces the status so rate limits are retried", async () => {
  stubFetch(429, { errors: [{ message: "Too many requests" }] });

  await assert.rejects(() => new CloudflareProvider().create(), /HTTP 429/);
});

test("a response without a session is an error", async () => {
  stubFetch(200, { success: true });

  await assert.rejects(() => new CloudflareProvider().create(), /missing sessionId/);
});

test("releasing deletes the session", async () => {
  const calls = stubFetch(200, { status: "closing" });

  await new CloudflareProvider().release("sess-1");

  assert.deepEqual(calls, [
    { url: `${BASE}/sess-1`, method: "DELETE", authorization: "Bearer test-token" },
  ]);
});

test("missing credentials fail on create, not on construction", async () => {
  delete process.env.CLOUDFLARE_API_TOKEN;

  const provider = new CloudflareProvider();
  await assert.rejects(() => provider.create(), /CLOUDFLARE_API_TOKEN/);
});

test("cost follows the hourly rate, metered per second", () => {
  const provider = new CloudflareProvider();

  assert.equal(provider.computeCost(3600), 0.09);
  assert.equal(provider.computeCost(60), 0.0015);
  assert.equal(provider.computeCost(0), 0);
});
