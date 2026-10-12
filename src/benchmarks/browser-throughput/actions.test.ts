/**
 * The browser throughput action loop against a real browser and two local pages, plus the pure
 * summaries that turn an action list into session numbers.
 *
 * Needs a Chromium: CI installs Playwright's build, a local Google Chrome works
 * too. The browser tests skip when neither is present.
 */

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

import { ARTICLE_POOL, fixedArticleUrl, resolveArticleUrls } from "./articles.js";
import {
  ACTIONS_PER_LOOP,
  MAX_CONSECUTIVE_FAILURES,
  runActionLoops,
  summarizeActions,
} from "./actions.js";
import type { AgentActionRecord } from "./types.js";

const SELECTORS = { heading: "h1#title", link: "a.next" };

function action(partial: Partial<AgentActionRecord> & { loop: number; duration_ms: number }): AgentActionRecord {
  return {
    index: 0,
    type: "navigate",
    success: true,
    error_message: null,
    skipped: false,
    ...partial,
  };
}

test("summarizeActions: totals add up and throughput uses completed actions only", () => {
  const actions = [
    action({ loop: 1, duration_ms: 100 }),
    action({ loop: 1, duration_ms: 300, success: false, error_message: "boom" }),
    action({ loop: 2, duration_ms: 600 }),
  ];
  const s = summarizeActions(actions, 2);
  assert.equal(s.actions_total, 3);
  assert.equal(s.actions_completed, 2);
  assert.equal(s.task_ms, 1000);
  assert.equal(s.actions_per_second, 2);
  assert.equal(s.first_loop_ms, 400);
  assert.equal(s.last_loop_ms, 600);
});

test("summarizeActions: an empty session has no throughput, not a division by zero", () => {
  const s = summarizeActions([], 1);
  assert.equal(s.task_ms, 0);
  assert.equal(s.actions_per_second, null);
  assert.equal(s.first_loop_ms, null);
});

test("fixedArticleUrl: same inputs give the same page, and loops within a session differ", () => {
  const day = new Date("2026-10-12T04:00:00Z");
  assert.equal(fixedArticleUrl(day, 3, 0, 5), fixedArticleUrl(day, 3, 0, 5));
  assert.notEqual(fixedArticleUrl(day, 3, 0, 5), fixedArticleUrl(day, 3, 1, 5));
  assert.notEqual(fixedArticleUrl(day, 0, 0, 1), fixedArticleUrl(new Date("2026-10-13T04:00:00Z"), 0, 0, 1));
  assert.match(fixedArticleUrl(day, 0, 0, 1), /^https:\/\/en\.wikipedia\.org\/wiki\//);
  assert.ok(new Set(ARTICLE_POOL).size === ARTICLE_POOL.length, "pool has duplicates");
});

test("resolveArticleUrls: a fixed assignment is a pure function of its inputs, so every provider shares it", async () => {
  const date = new Date("2026-10-12T04:00:00Z");
  const a = await resolveArticleUrls("fixed", 5, 2, date);
  const b = await resolveArticleUrls("fixed", 5, 2, date);
  for (let s = 0; s < 5; s++) for (let l = 0; l < 2; l++) assert.equal(a(s, l), b(s, l));
});

function isMissingBrowser(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Executable doesn't exist|is not found|ENOENT/i.test(message);
}

async function launch(): Promise<Browser | null> {
  for (const options of [{}, { channel: "chrome" as const }]) {
    try {
      return await chromium.launch(options);
    } catch (e) {
      if (!isMissingBrowser(e)) throw e;
    }
  }
  return null;
}

/** Two article-shaped pages: /a links to /b, both carry the heading. /bare has neither. */
async function startSite(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.url === "/b") {
      res.end('<!doctype html><html><body><h1 id="title">B</h1><p>second</p></body></html>');
    } else if (req.url === "/bare") {
      res.end("<!doctype html><html><body><p>nothing here</p></body></html>");
    } else {
      res.end('<!doctype html><html><body><h1 id="title">A</h1><p><a class="next" href="/b">to b</a></p></body></html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("runActionLoops: a healthy loop times all ten actions in order", async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("no Chromium available");
    return;
  }
  const site = await startSite();
  try {
    const page = await browser.newPage();
    const actions = await runActionLoops(page, () => `${site.base}/a`, 2, {
      selectors: SELECTORS,
      timeoutMs: 5_000,
    });

    assert.equal(actions.length, 2 * ACTIONS_PER_LOOP);
    assert.deepEqual(
      actions.slice(0, ACTIONS_PER_LOOP).map((a) => a.type),
      ["navigate", "waitForSelector", "screenshot", "textContent", "click", "waitForSelector", "screenshot", "textContent", "goBack", "waitForSelector"]
    );
    assert.ok(actions.every((a) => a.success), JSON.stringify(actions.filter((a) => !a.success)));
    assert.ok(actions.every((a) => a.duration_ms >= 0));
    assert.deepEqual(actions.map((a) => a.index), actions.map((_, i) => i + 1));
    assert.deepEqual(actions.map((a) => a.loop), [...Array(10).fill(1), ...Array(10).fill(2)]);

    const summary = summarizeActions(actions, 2);
    assert.equal(summary.actions_completed, 20);
    assert.ok(summary.actions_per_second! > 0);
  } finally {
    await site.close();
    await browser.close();
  }
});

test("runActionLoops: a failing action is recorded and the loop carries on, until failures pile up", async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("no Chromium available");
    return;
  }
  const site = await startSite();
  try {
    const page = await browser.newPage();
    const actions = await runActionLoops(page, () => `${site.base}/bare`, 1, {
      selectors: SELECTORS,
      timeoutMs: 300,
    });

    // navigate ok, waitForSelector fails, screenshot ok, textContent fails,
    // click fails, waitForSelector fails: three in a row, the rest is skipped.
    assert.deepEqual(
      actions.map((a) => (a.skipped ? "skip" : a.success ? "ok" : "fail")),
      ["ok", "fail", "ok", "fail", "fail", "fail", "skip", "skip", "skip", "skip"]
    );
    const skipped = actions.filter((a) => a.skipped);
    assert.equal(skipped.length, ACTIONS_PER_LOOP - MAX_CONSECUTIVE_FAILURES - 3);
    assert.ok(skipped.every((a) => a.duration_ms === 0 && a.error_message?.includes("skipped")));
    assert.ok(actions[1]!.error_message, "failed action carries its error");

    const summary = summarizeActions(actions, 1);
    assert.equal(summary.actions_completed, 2);
    assert.equal(summary.actions_total, ACTIONS_PER_LOOP);
  } finally {
    await site.close();
    await browser.close();
  }
});
