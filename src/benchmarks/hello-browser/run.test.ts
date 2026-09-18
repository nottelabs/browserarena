/**
 * Integration coverage for the hello-browser runner's two session lifecycles.
 *
 * Lightpanda has no session API: the session starts on CDP connect and ends
 * when the client disconnects, so the runner must release it with
 * `browser.close()` and leave `provider.release()` alone. Every other provider
 * is the reverse. Both paths are exercised against a real browser over CDP.
 *
 * Needs a Chromium: CI installs Playwright's build (`playwright-core install
 * chromium`), and a local Google Chrome works too. Skipped when neither is
 * present, so a fresh clone can still run `npm test`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { chromium } from "playwright-core";
import type { BrowserContext } from "playwright-core";

import type { ProviderClient, ProviderName, ProviderSession } from "../../types.js";
import { runSingleSession } from "./run.js";

/** A provider backed by a local browser, recording what the runner asks of it. */
class FakeProvider implements ProviderClient {
  readonly releases: string[] = [];

  constructor(
    readonly name: ProviderName,
    private readonly cdpUrl: string
  ) {}

  computeCost(): number {
    return 0;
  }

  async create(): Promise<ProviderSession> {
    return { id: this.name === "LIGHTPANDA" ? "" : "session-1", cdpUrl: this.cdpUrl };
  }

  async release(id: string): Promise<void> {
    this.releases.push(id);
  }
}

async function startPageServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body><h1>hello</h1></body></html>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A browser exposing a CDP endpoint, like a provider session. Chrome writes the
 * port it picked to DevToolsActivePort, and /json/version carries the URL.
 */
async function startCdpBrowser(): Promise<{ cdpUrl: string; close: () => Promise<void> } | null> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hello-browser-test-"));

  let context: BrowserContext | null = null;
  for (const options of [{}, { channel: "chrome" }]) {
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...options,
        args: ["--remote-debugging-port=0"],
      });
      break;
    } catch {
      // Try the next browser.
    }
  }
  if (!context) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    return null;
  }

  const port = fs
    .readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf-8")
    .split("\n")[0]!
    .trim();
  const version = await fetch(`http://127.0.0.1:${port}/json/version`);
  const { webSocketDebuggerUrl } = (await version.json()) as { webSocketDebuggerUrl: string };

  return {
    cdpUrl: webSocketDebuggerUrl,
    close: async () => {
      await context!.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

test("other providers are released through their API", async (t) => {
  const browser = await startCdpBrowser();
  if (!browser) {
    t.skip("no Chromium available");
    return;
  }
  const page = await startPageServer();

  try {
    const provider = new FakeProvider("STEEL", browser.cdpUrl);

    const record = await runSingleSession(provider, page.url, 1);

    assert.equal(record.error_message, null);
    assert.equal(record.success, true);
    assert.equal(record.id, "session-1");
    assert.deepEqual(provider.releases, ["session-1"]);
    assert.equal(typeof record.session_release_ms, "number");
  } finally {
    await page.close();
    await browser.close();
  }
});

test("Lightpanda is released by closing the browser", async (t) => {
  const browser = await startCdpBrowser();
  if (!browser) {
    t.skip("no Chromium available");
    return;
  }
  const page = await startPageServer();

  try {
    const provider = new FakeProvider("LIGHTPANDA", browser.cdpUrl);

    const record = await runSingleSession(provider, page.url, 1);

    assert.equal(record.error_message, null);
    assert.equal(record.success, true);

    // The connection is the session, so release() must not be called.
    assert.deepEqual(provider.releases, []);

    // Every phase is still timed, including the browser.close() release.
    for (const phase of [
      record.session_creation_ms,
      record.session_connect_ms,
      record.page_goto_ms,
      record.session_release_ms,
    ]) {
      assert.equal(typeof phase, "number", JSON.stringify(record));
    }
  } finally {
    await page.close();
    await browser.close();
  }
});

test("a failed connect records the stage instead of throwing", async () => {
  const provider = new FakeProvider("LIGHTPANDA", "ws://127.0.0.1:1/devtools/browser/none");

  const record = await runSingleSession(provider, "http://127.0.0.1:1/", 1);

  assert.equal(record.success, false);
  assert.equal(record.error_stage, "connect_over_cdp");
  assert.ok(record.error_message);

  // Nothing connected, so there is nothing to close and nothing to time.
  assert.equal(record.session_release_ms, null);
});
