import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { BrowserUseProvider } from "./browser-use.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.BROWSER_USE_API_KEY;

beforeEach(() => {
  process.env.BROWSER_USE_API_KEY = "test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.BROWSER_USE_API_KEY;
  else process.env.BROWSER_USE_API_KEY = originalApiKey;
});

test("requests recording when the benchmark asks for it", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      id: "browser-1",
      cdpUrl: "https://cdp.browser-use.com/browser-1",
    }));
  }) as typeof fetch;

  const session = await new BrowserUseProvider().create({ recording: true });

  assert.equal(requestUrl, "https://api.browser-use.com/api/v4/browsers");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    proxyCountryCode: null,
    enableRecording: true,
  });
  assert.equal(session.cdpUrl, "wss://cdp.browser-use.com/browser-1");
});

test("downloads the recording from the V4 browser record", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/browsers/browser-1")) {
      return new Response(JSON.stringify({
        status: "stopped",
        recordingUrl: "https://recordings.example/browser-1.mp4",
      }));
    }
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;

  const recording = await new BrowserUseProvider().downloadRecording("browser-1");

  assert.deepEqual(urls, [
    "https://api.browser-use.com/api/v4/browsers/browser-1",
    "https://recordings.example/browser-1.mp4",
  ]);
  assert.deepEqual([...recording.data], [1, 2, 3]);
  assert.equal(recording.format, "mp4");
});

test("stops the V4 browser session", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ status: "stopped" }));
  }) as typeof fetch;

  await new BrowserUseProvider().release("browser-1");

  assert.equal(requestUrl, "https://api.browser-use.com/api/v4/browsers/browser-1");
  assert.equal(requestInit?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { action: "stop" });
});
