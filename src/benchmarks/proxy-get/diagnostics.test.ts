import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { CDPSession, Page } from "playwright-core";
import { collectProxyDiagnostics } from "./diagnostics.js";
import type { ProxyGetRecord } from "./schema.js";

test("network diagnostics preserve blocked-request evidence without secrets or unrelated traffic", () => {
  const cdp = new EventEmitter();
  const page = new EventEmitter();
  const diagnostics: NonNullable<ProxyGetRecord["diagnostics"]> = { phase_ms: {}, network: [], browser_errors: [] };
  const url = "https://geo.example/check?token=private-secret";
  collectProxyDiagnostics(cdp as unknown as CDPSession, page as unknown as Page, [url], () => "country_verification", diagnostics);
  cdp.emit("Network.requestWillBeSent", { requestId: "1", request: { url } });
  cdp.emit("Network.responseReceivedExtraInfo", { requestId: "1", statusCode: 403,
    headers: { "Set-Cookie": "private-cookie", Authorization: "Bearer private-secret", "CF-Ray": "test-ray", "Server": "test" } });
  cdp.emit("Network.loadingFailed", { requestId: "1", errorText: "net::ERR_FAILED", canceled: false,
    blockedReason: "other", corsErrorStatus: { corsError: "MissingAllowOriginHeader" } });
  cdp.emit("Network.requestWillBeSent", { requestId: "2", request: { url: "https://unrelated.example/" } });
  page.emit("pageerror", new Error("connect wss://example.com?token=private-secret"));
  assert.equal(diagnostics.network.length, 1);
  assert.equal(diagnostics.network[0].endpoint, "https://geo.example/check");
  assert.equal(diagnostics.network[0].http_status, 403);
  assert.equal(diagnostics.network[0].cors_error, "MissingAllowOriginHeader");
  assert.deepEqual(diagnostics.network[0].headers, { "cf-ray": "test-ray", server: "test" });
  assert.equal(JSON.stringify(diagnostics).includes("private-secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("private-cookie"), false);
});
