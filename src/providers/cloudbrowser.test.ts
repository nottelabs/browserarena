import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { SessionCreationError } from "../types.js";
import { getRequiredEnvVarsForProvider, resolveProvider } from "./index.js";
import { CloudbrowserProvider } from "./cloudbrowser.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.CLOUDBROWSER_API_KEY;
const api = "https://cloudbrowser.tv/api/v1";
const fixtureKey = "fixture-cloudbrowser-key";
const browserId = "br-fixture";
const cdpUrl = "wss://cloudbrowser.tv/connect/br-fixture?token=fixture";

function operation(id: string, status: string): Response {
  return Response.json({ id, browserId, status });
}

beforeEach(() => { process.env.CLOUDBROWSER_API_KEY = fixtureKey; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.CLOUDBROWSER_API_KEY;
  else process.env.CLOUDBROWSER_API_KEY = originalKey;
});

test("registers, estimates Basic overage and rejects proxy use before an API call", async () => {
  assert.ok(resolveProvider(" Cloudbrowser ") instanceof CloudbrowserProvider);
  assert.deepEqual(getRequiredEnvVarsForProvider("cloudbrowser"), ["CLOUDBROWSER_API_KEY"]);
  const provider = new CloudbrowserProvider();
  assert.equal(provider.computeCost(1_800), 0.04);
  globalThis.fetch = async () => assert.fail("proxy benchmark must not create a Cloudbrowser instance");
  await assert.rejects(() => provider.create({ proxyCountry: "US" }), /country selection/);
});

test("waits for create and delete operations, using a separate scoped CDP grant", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${fixtureKey}`);
    assert.equal(init?.redirect, "error");
    if (url === `${api}/browsers`) {
      assert.equal(method, "POST");
      assert.match(headers.get("idempotency-key") ?? "", /^[a-f0-9-]{36}$/);
      assert.match(JSON.parse(String(init?.body)).name, /^BrowserArena /);
      return operation("op-create", "pending");
    }
    if (url === `${api}/operations/op-create`) return operation("op-create", "succeeded");
    if (url === `${api}/browsers/${browserId}/grants`) {
      assert.equal(method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { audience: "cdp", permission: "control" });
      return Response.json({ cdpUrl });
    }
    if (url === `${api}/browsers/${browserId}`) {
      assert.equal(method, "DELETE");
      assert.ok(headers.get("idempotency-key"));
      return operation("op-delete", "running");
    }
    if (url === `${api}/operations/op-delete`) return operation("op-delete", "succeeded");
    return assert.fail(`unexpected request ${url}`);
  };

  const provider = new CloudbrowserProvider();
  assert.deepEqual(await provider.create(), { id: browserId, cdpUrl });
  await provider.release(browserId);
  assert.deepEqual(calls, [
    `POST ${api}/browsers`,
    `GET ${api}/operations/op-create`,
    `POST ${api}/browsers/${browserId}/grants`,
    `DELETE ${api}/browsers/${browserId}`,
    `GET ${api}/operations/op-delete`,
  ]);
});

test("recovers a lost create response with the same idempotency key", async () => {
  const keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/grants")) return Response.json({ cdpUrl });
    keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
    if (keys.length === 1) throw new TypeError("connection closed");
    return operation("op-create", "succeeded");
  };
  assert.deepEqual(await new CloudbrowserProvider().create(), { id: browserId, cdpUrl });
  assert.equal(keys.length, 2);
  assert.ok(keys[0]);
  assert.equal(keys[0], keys[1]);
});

test("deletes the known browser if granting CDP fails and reports no upstream secret", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (init?.method === "DELETE") return operation("op-delete", "succeeded");
    if (url.endsWith("/grants")) {
      return Response.json({ error: { code: "grant_failed", message: fixtureKey } }, { status: 503 });
    }
    return operation("op-create", "succeeded");
  };
  await assert.rejects(() => new CloudbrowserProvider().create(), (error: unknown) => {
    assert.ok(error instanceof SessionCreationError);
    assert.equal(error.sessionId, browserId);
    assert.equal(error.cleanupError, null);
    assert.match(error.message, /grant_failed/);
    assert.doesNotMatch(error.message, /fixture-cloudbrowser-key/);
    return true;
  });
  assert.deepEqual(calls, [`${api}/browsers`, `${api}/browsers/${browserId}/grants`, `${api}/browsers/${browserId}`]);
});
