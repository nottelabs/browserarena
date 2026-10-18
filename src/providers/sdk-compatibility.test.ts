import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createAnchorbrowserClient } from "anchorbrowser";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { AnchorBrowserProvider } from "./anchorbrowser.js";
import { HyperbrowserProvider } from "./hyperbrowser.js";

const video = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 255, 128]);

async function fixture(t: TestContext, anchorKey = "anchor-key") {
  const requests: { method: string; path: string; body: unknown; key?: string }[] = [];
  let status = 200;
  let malformed = false;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ method: req.method!, path: req.url!, body: body ? JSON.parse(body) : null,
      key: (req.headers["anchor-api-key"] ?? req.headers["x-api-key"]) as string | undefined });
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "fixture failure", message: "fixture failure" }));
    } else if (req.url?.endsWith("/primary/fetch") || req.url === "/video.mp4") {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.end(video);
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(malformed ? {} : {
        data: { id: "anchor-session", cdp_url: "ws://anchor.local" },
        id: "hyper-session", wsEndpoint: "ws://hyper.local",
        status: "completed", recordingUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/video.mp4`,
      }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const anchor = new AnchorBrowserProvider();
  Object.assign(anchor, { _client: createAnchorbrowserClient({ baseUrl, auth: () => anchorKey }) });
  const hyper = new HyperbrowserProvider();
  Object.assign(hyper, { _client: new Hyperbrowser({ baseUrl, apiKey: "hyper-key" }) });
  return { anchor, hyper, requests, fail: () => { status = 503; }, malform: () => { malformed = true; } };
}

test("Anchor v1 preserves lifecycle defaults, authentication, release and binary recordings", async t => {
  const { anchor, requests } = await fixture(t);
  assert.deepEqual(await anchor.create(), { id: "anchor-session", cdpUrl: "ws://anchor.local" });
  assert.deepEqual(requests.at(-1), { method: "POST", path: "/v1/sessions", body: { session: {} }, key: "anchor-key" });
  await anchor.release("anchor-session");
  assert.deepEqual(requests.at(-1), { method: "DELETE", path: "/v1/sessions/anchor-session", body: null, key: "anchor-key" });
  assert.deepEqual(await anchor.downloadRecording("anchor-session"), { data: video, format: "mp4", extension: ".mp4" });
  assert.equal(requests.at(-1)!.path, "/v1/sessions/anchor-session/recordings/primary/fetch");
  assert.equal(requests.at(-1)!.key, "anchor-key");
});

test("Anchor v1 rejects malformed sessions and surfaces failed creates and releases without retries", async t => {
  const { anchor, requests, fail, malform } = await fixture(t);
  malform();
  await assert.rejects(anchor.create(), /Invalid Anchorbrowser session response/);
  fail();
  await assert.rejects(anchor.create({ proxyCountry: "US" }), { status: 503 });
  assert.equal(requests.length, 2, "a failed proxy create must not create duplicate sessions");
  await assert.rejects(anchor.release("anchor-session"), { status: 503 });
  assert.equal(requests.length, 3);
});

test("Anchor clients keep their credentials isolated and bound proxy creation to 90 seconds", async t => {
  const first = await fixture(t);
  const second = await fixture(t, "second-key");
  const timeout = t.mock.method(AbortSignal, "timeout");
  await first.anchor.create({ proxyCountry: "JP", recording: true });
  assert.equal(timeout.mock.calls[0].arguments[0], 90_000);
  await second.anchor.create();
  assert.equal(first.requests.length, 1);
  assert.equal(second.requests.length, 1);
  assert.equal(first.requests[0].key, "anchor-key");
  assert.equal(second.requests[0].key, "second-key");
  assert.deepEqual(first.requests[0].body, {
    browser: { adblock: { active: false }, popup_blocker: { active: false } },
    session: { recording: { active: true }, proxy: { active: true, type: "anchor_proxy", country_code: "jp" } },
  });
});

test("Hyperbrowser v1 preserves lifecycle, proxy and recording requests", async t => {
  const { hyper, requests } = await fixture(t);
  assert.deepEqual(await hyper.create(), { id: "hyper-session", cdpUrl: "ws://hyper.local" });
  assert.deepEqual(requests.at(-1), { method: "POST", path: "/api/session", body: { region: "us-east" }, key: "hyper-key" });
  await hyper.create({ proxyCountry: "FR", recording: true });
  assert.deepEqual(requests.at(-1)!.body, { region: "us-east", useProxy: true, proxyCountry: "FR", enableVideoWebRecording: true });
  await hyper.release("hyper-session");
  assert.deepEqual(requests.at(-1), { method: "PUT", path: "/api/session/hyper-session/stop", body: null, key: "hyper-key" });
  assert.deepEqual(await hyper.downloadRecording("hyper-session"), { data: video, format: "mp4", extension: ".mp4" });
  assert.equal(requests.at(-2)!.path, "/api/session/hyper-session/video-recording-url");
  assert.equal(requests.at(-1)!.key, undefined, "provider credentials must not reach the video download host");
});

test("Hyperbrowser v1 rejects invalid sessions and surfaces failed creates and releases without retries", async t => {
  const { hyper, requests, fail, malform } = await fixture(t);
  malform();
  await assert.rejects(hyper.create(), /Invalid Hyperbrowser session response/);
  fail();
  await assert.rejects(hyper.create({ proxyCountry: "US" }), /fixture failure/);
  assert.equal(requests.length, 2);
  await assert.rejects(hyper.release("hyper-session"), /fixture failure/);
  assert.equal(requests.length, 3);
});
