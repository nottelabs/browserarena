import fs from "node:fs";
import { chromium } from "playwright-core";
import type { ProviderClient } from "../../types.js";
import { isoUtcNow, nowNs, msSince } from "../../utils/time.js";
import type { V0Record } from "./types.js";

export async function runSingleSession(
  provider: ProviderClient,
  url: string,
  concurrency: number = 1
): Promise<V0Record> {
  let session: { id: string } | null = null;
  let stage = "init";

  const result: V0Record = {
    created_at: isoUtcNow(),
    id: null,
    session_creation_ms: null,
    session_connect_ms: null,
    page_goto_ms: null,
    page_ttfb_ms: null,
    page_dom_content_loaded_ms: null,
    page_load_ms: null,
    session_release_ms: null,
    provider: provider.name,
    concurrency,
    success: false,
    error_stage: null,
    error_message: null,
    cost_usd: null,
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
    const browser = await chromium.connectOverCDP(cdpUrl);
    result.session_connect_ms = msSince(t1);
    console.error(`[Browser connected] ${result.session_connect_ms}ms`);

    stage = "page_goto";
    const t2 = nowNs();
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "load" });
    result.page_goto_ms = msSince(t2);
    console.error(`[Page loaded] ${result.page_goto_ms}ms`);

    stage = "nav_timing";
    const navTiming = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      if (!entry) return null;
      return {
        ttfb: Math.round(entry.responseStart - entry.startTime),
        domContentLoaded: Math.round(entry.domContentLoadedEventEnd - entry.startTime),
        load: Math.round(entry.loadEventEnd - entry.startTime),
      };
    });

    if (navTiming) {
      result.page_ttfb_ms = navTiming.ttfb;
      result.page_dom_content_loaded_ms = navTiming.domContentLoaded;
      result.page_load_ms = navTiming.load;
      console.error(
        `[Nav timing] ttfb=${navTiming.ttfb}ms dcl=${navTiming.domContentLoaded}ms load=${navTiming.load}ms`
      );
    }

    result.success = true;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.stack || e.message : `${e}`;
    result.error_stage = stage;
    result.error_message = message;
    console.error(`[ERROR] stage=${stage} id=${result.id} ${message}`);
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

    const totalMs =
      (result.session_creation_ms ?? 0) +
      (result.session_connect_ms ?? 0) +
      (result.page_goto_ms ?? 0) +
      (result.session_release_ms ?? 0);
    result.cost_usd = provider.computeCost(totalMs / 1000);

    if (provider.name === "BROWSERBASE") {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(3000 - totalMs, 0))
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
  const minIntervalMs = rate ? (60 / rate) * 1000 : 0;

  console.error(
    `\n[CONFIG] provider=${provider.name} concurrency=${concurrency} runs=${runs}`
  );
  if (rate) {
    console.error(
      `[RATE_LIMIT] Throttling to ${rate} sessions/min (${(minIntervalMs / 1000).toFixed(1)}s interval)`
    );
  }

  for (let i = 1; i <= WARMUP_RUNS; i++) {
    const start = Date.now();
    console.error(`[WARMUP] ${i}/${WARMUP_RUNS}`);
    await runSingleSession(provider, url, concurrency);
    await throttle(start, minIntervalMs);
  }

  let success = 0;
  let failure = 0;

  for (let i = 1; i <= runs; i++) {
    const start = Date.now();
    console.error(`[RUN] ${i}/${runs} (c=${concurrency})`);

    const batch = Array.from({ length: concurrency }, () =>
      runSingleSession(provider, url, concurrency)
    );
    const records = await Promise.all(batch);

    for (const record of records) {
      fs.appendFileSync(out, JSON.stringify(record) + "\n", {
        encoding: "utf-8",
      });
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
