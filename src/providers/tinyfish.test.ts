import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { SessionCreationError } from "../types.js";
import { getMissingEnvVarsForProvider, getRequiredEnvVarsForProvider, resolveProvider } from "./index.js";
import { TinyFishProvider } from "./tinyfish.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TINYFISH_API_KEY;

beforeEach(() => { process.env.TINYFISH_API_KEY = "tinyfish-test-key"; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = originalApiKey;
});

test("registers TinyFish and checks its key before creating a session", async () => {
  assert.ok(resolveProvider(" TinyFish ") instanceof TinyFishProvider);
  assert.deepEqual(getRequiredEnvVarsForProvider("tinyfish"), ["TINYFISH_API_KEY"]);
  assert.deepEqual(getMissingEnvVarsForProvider("tinyfish"), []);
  delete process.env.TINYFISH_API_KEY;
  assert.deepEqual(getMissingEnvVarsForProvider("tinyfish"), ["TINYFISH_API_KEY"]);
  globalThis.fetch = async () => { throw new Error("must not contact TinyFish without a key"); };
  await assert.rejects(() => new TinyFishProvider().create(), /TINYFISH_API_KEY/);
});

test("creates a blank browser without a proxy and preserves its CDP URL", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.browser.tinyfish.ai");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "tinyfish-test-key");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), { proxy_config: { enabled: false } });
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ session_id: "br-1", cdp_url: "wss://browser.example/cdp?token=fixture" }, { status: 201 });
  };
  assert.deepEqual(await new TinyFishProvider().create(), {
    id: "br-1", cdpUrl: "wss://browser.example/cdp?token=fixture",
  });
});

test("keeps HTTP failures and request IDs without retrying or exposing credentials", async () => {
  for (const status of [401, 402, 429, 503]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: { code: "UPSTREAM_ERROR", message: "tinyfish-test-key" } }, {
        status, headers: { "X-Request-ID": "request-1" },
      });
    };
    await assert.rejects(() => new TinyFishProvider().create(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { status: number }).status, status);
      assert.equal((error as Error & { requestId: string }).requestId, "request-1");
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /tinyfish-test-key/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("does not try cleanup without a valid session ID", async () => {
  for (const session_id of [undefined, null, "", 123]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ session_id, cdp_url: "wss://browser.example/cdp" });
    };
    await assert.rejects(() => new TinyFishProvider().create(), /missing session_id/);
    assert.equal(calls, 1);
  }
});

test("releases paid sessions when their CDP URL is missing or unusable", async () => {
  for (const cdp_url of [undefined, 123, "", "not-a-url", "https://browser.example/cdp"]) {
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method} ${input}`);
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ session_id: "br-1", cdp_url });
    };
    await assert.rejects(() => new TinyFishProvider().create(), (error: unknown) => {
      assert.ok(error instanceof SessionCreationError);
      assert.equal(error.sessionId, "br-1");
      assert.equal(error.cleanupError, null);
      assert.ok(error.releaseMs !== null);
      assert.match(error.message, /invalid cdp_url/);
      return true;
    });
    assert.deepEqual(calls, ["POST https://api.browser.tinyfish.ai", "DELETE https://api.browser.tinyfish.ai/br-1"]);
  }
});

test("reports failed cleanup alongside invalid session data", async () => {
  globalThis.fetch = async (_input, init) => init?.method === "DELETE"
    ? new Response("termination not confirmed", { status: 503 })
    : Response.json({ session_id: "br-1" });
  await assert.rejects(() => new TinyFishProvider().create(), (error: unknown) => {
    assert.ok(error instanceof SessionCreationError);
    assert.equal(error.sessionId, "br-1");
    assert.match(error.cleanupError!, /release failed: HTTP 503/);
    assert.equal(error.releaseMs, null);
    return true;
  });
});

test("explicitly terminates sessions and allows repeated successful releases", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.browser.tinyfish.ai/br%2F1");
    assert.equal(init?.method, "DELETE");
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "tinyfish-test-key");
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(null, { status: 204 });
  };
  const provider = new TinyFishProvider();
  await provider.release("br/1");
  await provider.release("br/1");
});

test("does not hide termination failures, including an unknown session", async () => {
  for (const status of [404, 409, 500, 503]) {
    globalThis.fetch = async () => new Response("tinyfish-test-key: termination not confirmed", { status });
    await assert.rejects(() => new TinyFishProvider().release("br-1"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(`release failed: HTTP ${status}`));
      assert.doesNotMatch(error.message, /tinyfish-test-key/);
      return true;
    });
  }
});

test("rejects unverified proxy measurements before creating paid sessions", async () => {
  globalThis.fetch = async () => { throw new Error("must not create an unverified proxy session"); };
  await assert.rejects(() => new TinyFishProvider().create({ proxyCountry: "US" }), /not been verified/);
});

test("estimates duration cost at $0.002 per browser-minute without rounding up", () => {
  const provider = new TinyFishProvider();
  assert.equal(provider.computeCost(0), 0);
  assert.equal(provider.computeCost(30), 0.001);
  assert.equal(provider.computeCost(60), 0.002);
  assert.equal(provider.computeCost(90), 0.003);
  assert.equal(provider.computeCost(3600), 0.12);
});
