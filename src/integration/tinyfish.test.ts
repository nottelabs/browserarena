import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Browser } from "playwright-core";
import { TinyFishProvider } from "../providers/tinyfish.js";
import { sanitizeErrorMessage } from "../utils/sanitize.js";

// Explicitly invoked with npm run test:tinyfish; this creates a paid session.
test("TinyFish live API creates, connects, navigates, and terminates a browser", async () => {
  const provider = new TinyFishProvider();
  const session = await provider.create();
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(session.cdpUrl);
    const context = browser.contexts()[0];
    assert.ok(context, "TinyFish must expose a browser context over CDP");
    const page = await context.newPage();
    const url = "https://www.browserarena.ai/api/proxy-get/bootstrap";
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200);
    assert.equal(page.url(), url);
    assert.equal(await page.title(), "Proxy Performance runner");
  } catch (error) {
    // CDP errors can contain the authenticated WebSocket URL.
    throw new Error(sanitizeErrorMessage(error instanceof Error ? error.message : String(error)));
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await provider.release(session.id);
    }
  }
});
