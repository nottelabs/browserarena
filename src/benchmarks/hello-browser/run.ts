import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { ProviderClient } from "../../types.js";
import type { HelloBrowserRecord } from "./types.js";
import { isoUtcNow, nowNs, msSince } from "../../utils/time.js";

function screenshotBaseName(
  createdAt: string,
  sessionId: string | null,
  stage: string
): string {
  const t = createdAt.replace(/[:.]/g, "-");
  const id = (sessionId ?? "noid").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 48);
  const st = stage.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${t}_${id}_${st}.png`;
}

async function tryCaptureErrorScreenshot(
  screenshotsDir: string,
  createdAt: string,
  sessionId: string | null,
  stage: string,
  page: Page | null,
  browser: Browser | null
): Promise<string | null> {
  let target: Page | null = page;
  if (!target && browser) {
    try {
      for (const ctx of browser.contexts()) {
        const pages = ctx.pages();
        if (pages.length > 0) {
          target = pages[0]!;
          break;
        }
      }
    } catch {
      // ignore
    }
  }
  if (!target) return null;

  try {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const file = screenshotBaseName(createdAt, sessionId, stage);
    const absPath = path.join(screenshotsDir, file);
    await target.screenshot({ path: absPath, fullPage: true });
    const rel = path.relative(process.cwd(), absPath);
    const stored = rel && !rel.startsWith("..") ? rel : absPath;
    console.error(`[SCREENSHOT] ${stored}`);
    return stored;
  } catch (e: unknown) {
    console.error(
      `[SCREENSHOT_ERROR] ${e instanceof Error ? e.message : e}`
    );
    return null;
  }
}

export async function runSingleSession(
  provider: ProviderClient,
  url: string,
  concurrency: number = 1,
  screenshotsDir?: string
): Promise<HelloBrowserRecord> {
  let session: { id: string } | null = null;
  let stage = "init";
  let browser: Browser | null = null;
  let page: Page | null = null;

  const result: HelloBrowserRecord = {
    created_at: isoUtcNow(),
    id: null,
    session_creation_ms: null,
    session_connect_ms: null,
    page_goto_ms: null,
    session_release_ms: null,
    provider: provider.name,
    concurrency,
    success: false,
    error_stage: null,
    error_message: null,
    error_screenshot_path: null,
  };

  try {
    stage = "session_create";
    let id: string;
    let cdpUrl: string;

    while (true) {
      try {
        const t0 = nowNs();
        const created = await provider.create();
        ({ id, cdpUrl } = created);
        result.id = id;
        session = { id };
        result.session_creation_ms = msSince(t0);
        console.error(
          `[Session created] provider=${provider.name} id=${id} ${result.session_creation_ms}ms`
        );
        break;
      } catch (e: unknown) {
        const err = e as { status?: number; statusCode?: number; response?: { status?: number } };
        const status = err?.status ?? err?.statusCode ?? err?.response?.status;
        const message = e instanceof Error ? e.message : `${e}`;
        const isRateLimit =
          status === 429 || /rate|limit|429|too many/i.test(message || "");
        if (isRateLimit) {
          console.error(
            `[RATE_LIMIT] provider=${provider.name} message="${message}" → retry in 30s`
          );
          await new Promise((r) => setTimeout(r, 30_000));
          continue;
        }
        throw e;
      }
    }

    stage = "connect_over_cdp";
    const t1 = nowNs();
    browser = await chromium.connectOverCDP(cdpUrl);
    result.session_connect_ms = msSince(t1);
    console.error(`[Browser connected] ${result.session_connect_ms}ms`);

    stage = "page_goto";
    const t2 = nowNs();
    const context = browser.contexts()[0] || (await browser.newContext());
    page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });
    result.page_goto_ms = msSince(t2);
    console.error(`[Page loaded] ${result.page_goto_ms}ms`);

    result.success = true;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.stack || e.message : `${e}`;
    result.error_stage = stage;
    result.error_message = message;
    console.error(`[ERROR] stage=${stage} id=${result.id} ${message}`);
    if (screenshotsDir) {
      result.error_screenshot_path = await tryCaptureErrorScreenshot(
        screenshotsDir,
        result.created_at,
        result.id,
        stage,
        page,
        browser
      );
    }
  } finally {
    if (session?.id) {
      try {
        stage = "session_release";
        const t3 = nowNs();
        await provider.release(session.id);
        result.session_release_ms = msSince(t3);
        console.error(`[Session released] ${result.session_release_ms}ms`);
      } catch (e: unknown) {
        console.error(
          `[SESSION_RELEASE_ERROR] id=${session.id} ${(e as Error)?.message || e}`
        );
      }
    }

    if (provider.name === "BROWSERBASE") {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(
            3000 -
            ((result.session_creation_ms ?? 0) +
              (result.session_connect_ms ?? 0) +
              (result.page_goto_ms ?? 0) +
              (result.session_release_ms ?? 0)),
            0
          )
        )
      );
    }
  }

  return result;
}

const WARMUP_RUNS = 10;

export async function runLoop(
  provider: ProviderClient,
  { runs, url, out, rate, concurrency = 1 }: {
    runs: number;
    url: string;
    out: string;
    rate?: number;
    concurrency?: number;
  }
) {
  const effectiveRate =
    rate ??
    (provider.name === "KERNEL" || provider.name === "KERNEL_HEADFUL"
      ? 10
      : undefined);
  const minIntervalMs = effectiveRate ? (60 / effectiveRate) * 1000 : 0;

  console.error(`\n[CONFIG] provider=${provider.name} concurrency=${concurrency} runs=${runs}`);
  if (effectiveRate) {
    console.error(
      `[RATE_LIMIT] Throttling to ${effectiveRate} sessions/min (${(minIntervalMs / 1000).toFixed(1)}s interval)`
    );
  }

  const screenshotsDir = path.join(path.dirname(out), "screenshots");

  for (let i = 1; i <= WARMUP_RUNS; i++) {
    const start = Date.now();
    console.error(`[WARMUP] ${i}/${WARMUP_RUNS}`);
    await runSingleSession(provider, url, concurrency, screenshotsDir);
    await throttle(start, minIntervalMs);
  }

  let success = 0;
  let failure = 0;

  for (let i = 1; i <= runs; i++) {
    const start = Date.now();
    console.error(`[RUN] ${i}/${runs} (c=${concurrency})`);

    const batch = Array.from({ length: concurrency }, () =>
      runSingleSession(provider, url, concurrency, screenshotsDir)
    );
    const records = await Promise.all(batch);

    for (const record of records) {
      fs.appendFileSync(out, JSON.stringify(record) + "\n", { encoding: "utf-8" });
      if (record.success) success++;
      else failure++;
    }

    await throttle(start, minIntervalMs);
  }

  console.error(`[DONE] c=${concurrency} success=${success} failure=${failure}`);
}

async function throttle(startTime: number, minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const elapsed = Date.now() - startTime;
  const remaining = minIntervalMs - elapsed;
  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }
}
