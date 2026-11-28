import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { SessionCreationError } from "../types.js";
import { getMissingEnvVarsForProvider, getRequiredEnvVarsForProvider, resolveProvider } from "./index.js";
import { SpecStreamProvider } from "./specstream.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.SPECSTREAM_API_KEY;
const originalBase = process.env.SPECSTREAM_API_BASE;

beforeEach(() => {
  process.env.SPECSTREAM_API_KEY = "specstream-test-key";
  delete process.env.SPECSTREAM_API_BASE;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.SPECSTREAM_API_KEY;
  else process.env.SPECSTREAM_API_KEY = originalApiKey;
  if (originalBase === undefined) delete process.env.SPECSTREAM_API_BASE;
  else process.env.SPECSTREAM_API_BASE = originalBase;
});

test("registers SpecStream and checks its key before creating a session", async () => {
  assert.ok(resolveProvider(" SpecStream ") instanceof SpecStreamProvider);
  assert.deepEqual(getRequiredEnvVarsForProvider("specstream"), ["SPECSTREAM_API_KEY"]);
  assert.deepEqual(getMissingEnvVarsForProvider("specstream"), []);
  delete process.env.SPECSTREAM_API_KEY;
  assert.deepEqual(getMissingEnvVarsForProvider("specstream"), ["SPECSTREAM_API_KEY"]);
  globalThis.fetch = async () => { throw new Error("must not contact SpecStream without a key"); };
  await assert.rejects(() => new SpecStreamProvider().create(), /SPECSTREAM_API_KEY/);
});

test("creates a headless browser session and returns its CDP URL", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.specstream.ai/v1/browser/sessions");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer specstream-test-key");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({
      ok: true,
      data: { id: "bs_1", connect_url: "wss://api.specstream.ai/v1/browser/cdp/bs_1" },
    });
  };
  assert.deepEqual(await new SpecStreamProvider().create(), {
    id: "bs_1",
    cdpUrl: "wss://api.specstream.ai/v1/browser/cdp/bs_1",
    configuration: { headless: true },
  });
});

test("keeps HTTP failures and request IDs without retrying or exposing credentials", async () => {
  for (const status of [401, 402, 429, 503]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: { message: "specstream-test-key" } }, {
        status,
        headers: { "X-Request-ID": "req-1" },
      });
    };
    await assert.rejects(() => new SpecStreamProvider().create(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { status: number }).status, status);
      assert.equal((error as Error & { requestId: string }).requestId, "req-1");
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /specstream-test-key/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("releases sessions when connect_url is missing or unusable", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method} ${input}`);
    return String(input).endsWith("/release")
      ? Response.json({ ok: true })
      : Response.json({ data: { id: "bs_bad", connect_url: "https://not-ws.example" } });
  };
  await assert.rejects(() => new SpecStreamProvider().create(), (error: unknown) => {
    assert.ok(error instanceof SessionCreationError);
    assert.equal(error.sessionId, "bs_bad");
    assert.equal(error.cleanupError, null);
    assert.ok(error.releaseMs !== null);
    return true;
  });
  assert.deepEqual(calls, [
    "POST https://api.specstream.ai/v1/browser/sessions",
    "POST https://api.specstream.ai/v1/browser/sessions/bs_bad/release",
  ]);
});

test("explicitly releases sessions and rejects proxyCountry requests", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.specstream.ai/v1/browser/sessions/bs%2F1/release");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer specstream-test-key");
    return Response.json({ ok: true });
  };
  const provider = new SpecStreamProvider();
  await provider.release("bs/1");
  globalThis.fetch = async () => { throw new Error("must not call API for unsupported proxy"); };
  await assert.rejects(() => provider.create({ proxyCountry: "US" }), /Madrid/);
});

test("bills $0.10 per hour by the second", () => {
  const provider = new SpecStreamProvider();
  assert.equal(provider.computeCost(0), 0);
  assert.equal(provider.computeCost(36), 0.001);
  assert.equal(provider.computeCost(3600), 0.1);
});
