/**
 * Integration coverage for the v0 extraction phase.
 *
 * The link filter runs inside the page, so it can only be exercised in a real
 * browser. This serves a fixture that mirrors the markup Wikipedia returns
 * today — absolute same-origin hrefs (MediaWiki 1.47) — and asserts the filter
 * keeps article links and drops everything else.
 *
 * Needs a Chromium: CI installs Playwright's build (`playwright-core install
 * chromium`), and a local Google Chrome works too. Skipped when neither is
 * present, so a fresh clone can still run `npm test`.
 */

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

import { phaseExtract } from "./phases.js";

/** Article body mirroring Wikipedia's structure, with one link per case. */
function fixtureHtml(origin: string): string {
  return `<!doctype html>
<html><body>
  <h1 id="firstHeading">Fixture article</h1>
  <div id="mw-content-text"><div class="mw-parser-output">
    <p>${"Fixture prose long enough to be picked up as the summary. ".repeat(3)}</p>
    <img src="${origin}/image.png" alt="">
    <!-- kept: absolute same-origin article links, in document order -->
    <a href="${origin}/wiki/First_article">first</a>
    <a href="${origin}/wiki/Second_article">second</a>
    <!-- kept: relative form, still served by older MediaWiki and mirrors -->
    <a href="/wiki/Third_article">third</a>
    <!-- kept: duplicate of an earlier link, counted but not crawled twice -->
    <a href="${origin}/wiki/First_article">first again</a>
    <!-- dropped: namespace (colon in the path) -->
    <a href="${origin}/wiki/Category:Fixtures">category</a>
    <a href="/wiki/Help:Contents">help</a>
    <!-- dropped: fragment-only and section links -->
    <a href="#section">section</a>
    <a href="${origin}/wiki/Fourth_article#History">fourth, section</a>
    <!-- dropped: other origin -->
    <a href="https://example.com/wiki/Elsewhere">off-site</a>
    <!-- dropped: not an article path -->
    <a href="${origin}/w/index.php?title=Fixture">edit</a>
    <!-- dropped: unparseable href -->
    <a href="http://">broken</a>
  </div></div>
</body></html>`;
}

async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" }).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fixtureHtml(origin));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/wiki/Fixture_article`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** True when the browser is simply not installed, as on a fresh clone. */
function isMissingBrowser(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Executable doesn't exist|is not found|ENOENT/i.test(message);
}

/**
 * Playwright's chromium, else a system Chrome. Returns null only when neither
 * is installed — any other launch failure is a real problem and must surface
 * rather than quietly skipping the test.
 */
async function launchChromium(): Promise<Browser | null> {
  try {
    return await chromium.launch();
  } catch (e) {
    if (!isMissingBrowser(e)) throw e;
  }
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (e) {
    if (!isMissingBrowser(e)) throw e;
    return null;
  }
}

test("extract keeps article links whether the href is absolute or relative", async (t) => {
  const browser = await launchChromium();
  if (!browser) {
    t.skip("no Chromium available");
    return;
  }

  const server = await startFixtureServer();
  try {
    const page = await (await browser.newContext()).newPage();
    const article = await phaseExtract(page, server.url);

    assert.equal(article.title, "Fixture article");

    // Absolute and relative hrefs both resolve; namespaces, fragments,
    // other origins and non-article paths are dropped. Crawl targets are
    // deduplicated, so "First_article" appears once.
    assert.deepEqual(article.internalLinks, [
      "/wiki/First_article",
      "/wiki/Second_article",
      "/wiki/Third_article",
    ]);

    // outboundLinkCount is not deduplicated: it counts the four article links.
    assert.equal(article.outboundLinkCount, 4);

    assert.ok(article.summary.startsWith("Fixture prose"), article.summary);
    assert.equal(article.imageCount, 1);
    assert.ok(article.wordCount > 0);
  } finally {
    await server.close();
    await browser.close();
  }
});
