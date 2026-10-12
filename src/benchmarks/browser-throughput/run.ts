import fs from "node:fs";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { ProviderClient } from "../../types.js";
import { isoUtcNow, nowNs, msSince } from "../../utils/time.js";
import { sanitizeErrorMessage } from "../../utils/sanitize.js";
import type { BrowserThroughputRecord } from "./types.js";
import { ACTIONS_PER_LOOP, DEFAULT_ACTION_TIMEOUT_MS, runActionLoops, summarizeActions } from "./actions.js";
import type { UrlForSlot } from "./articles.js";

/**
 * Every provider gets the same viewport. Vision agents pay for every pixel of
 * every screenshot, and the default viewports differ wildly across providers.
 */
export const VIEWPORT = { width: 1920, height: 1080 };

export interface BrowserThroughputSessionOptions {
  concurrency: number;
  loops: number;
  urlForLoop: (loop: number) => string;
  actionTimeoutMs?: number;
  warmup?: boolean;
  coldStart?: boolean;
}

export async function runSingleSession(
  provider: ProviderClient,
  opts: BrowserThroughputSessionOptions
): Promise<BrowserThroughputRecord> {
  const loops = opts.loops;
  let session: { id: string } | null = null;
  let stage = "init";
  let browser: Browser | null = null;
  let page: Page | null = null;

  const result: BrowserThroughputRecord = {
    created_at: isoUtcNow(),
    id: null,
    provider: provider.name,
    concurrency: opts.concurrency,
    warmup: opts.warmup ?? false,
    cold_start: opts.coldStart ?? false,
    success: false,
    error_stage: null,
    error_message: null,
    session_creation_ms: null,
    session_connect_ms: null,
    session_release_ms: null,
    viewport_width: VIEWPORT.width,
    viewport_height: VIEWPORT.height,
    loops,
    actions_total: loops * ACTIONS_PER_LOOP,
    actions_completed: 0,
    task_ms: null,
    actions_per_second: null,
    first_loop_ms: null,
    last_loop_ms: null,
    actions: [],
    article_urls: Array.from({ length: loops }, (_, i) => opts.urlForLoop(i + 1)),
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
        console.error(`[Session created] provider=${provider.name} id=${id} ${result.session_creation_ms}ms`);
        break;
      } catch (e: unknown) {
        const err = e as { status?: number; statusCode?: number; response?: { status?: number } };
        const status = err?.status ?? err?.statusCode ?? err?.response?.status;
        const message = e instanceof Error ? e.message : `${e}`;
        const isRateLimit = status === 429 || /rate|limit|429|too many/i.test(message || "");
        if (isRateLimit) {
          console.error(`[RATE_LIMIT] provider=${provider.name} message="${message}" → retry in 30s`);
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

    stage = "viewport";
    // Lightpanda needs a new context for each session.
    const context =
      provider.name === "LIGHTPANDA"
        ? await browser.newContext()
        : browser.contexts()[0] || (await browser.newContext());
    page = context.pages()[0] || (await context.newPage());
    await page.setViewportSize(VIEWPORT);

    stage = "actions";
    const actions = await runActionLoops(page, opts.urlForLoop, loops, {
      timeoutMs: opts.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      log: (line) => console.error(line),
    });
    const summary = summarizeActions(actions, loops);
    result.actions = actions;
    result.actions_total = summary.actions_total;
    result.actions_completed = summary.actions_completed;
    result.task_ms = summary.task_ms;
    result.actions_per_second = summary.actions_per_second;
    result.first_loop_ms = summary.first_loop_ms;
    result.last_loop_ms = summary.last_loop_ms;

    // Strict on purpose: an agent that fails one action in fifty fails one
    // task in fifty. Partial completion is still visible in actions_completed.
    result.success = summary.actions_completed === summary.actions_total;
    if (!result.success) {
      result.error_stage = "actions";
      const firstFailure = actions.find((a) => !a.success && !a.skipped);
      result.error_message = firstFailure
        ? `${firstFailure.type} #${firstFailure.index}: ${firstFailure.error_message}`
        : "not every action completed";
    }
    console.error(
      `[Actions] ${summary.actions_completed}/${summary.actions_total} ok, task=${summary.task_ms}ms, ${summary.actions_per_second ?? 0} actions/s`
    );
  } catch (e: unknown) {
    const message = sanitizeErrorMessage(e instanceof Error ? e.stack || e.message : `${e}`);
    result.error_stage = stage;
    result.error_message = message;
    console.error(`[ERROR] stage=${stage} id=${result.id} ${message}`);
  } finally {
    if (provider.name === "LIGHTPANDA") {
      // Closing the connection ends a Lightpanda session.
      if (browser) {
        try {
          stage = "session_release";
          const t3 = nowNs();
          await browser.close();
          result.session_release_ms = msSince(t3);
          console.error(`[Session released] ${result.session_release_ms}ms`);
        } catch (e: unknown) {
          console.error(`[SESSION_RELEASE_ERROR] id=${result.id} ${(e as Error)?.message || e}`);
        }
      }
    } else if (session?.id) {
      try {
        stage = "session_release";
        const t3 = nowNs();
        await provider.release(session.id);
        result.session_release_ms = msSince(t3);
        console.error(`[Session released] ${result.session_release_ms}ms`);
      } catch (e: unknown) {
        console.error(`[SESSION_RELEASE_ERROR] id=${session.id} ${(e as Error)?.message || e}`);
      }
    }

    const totalMs =
      (result.session_creation_ms ?? 0) +
      (result.session_connect_ms ?? 0) +
      (result.task_ms ?? 0) +
      (result.session_release_ms ?? 0);
    result.cost_usd = provider.computeCost(totalMs / 1000);

    if (provider.name === "BROWSERBASE") {
      await new Promise((resolve) => setTimeout(resolve, Math.max(3000 - totalMs, 0)));
    }
  }

  return result;
}

/** Sessions are longer here than in hello-browser, so fewer warm-ups suffice. */
export const WARMUP_RUNS = 3;

export async function runLoop(
  provider: ProviderClient,
  {
    runs,
    out,
    rate,
    concurrency = 1,
    loops = 1,
    urlFor,
    actionTimeoutMs,
  }: {
    /** Measured sessions. */
    runs: number;
    out: string;
    rate?: number;
    concurrency?: number;
    loops?: number;
    /** Start page per (session slot, loop index), resolved once per command and shared across providers. */
    urlFor: UrlForSlot;
    actionTimeoutMs?: number;
  }
) {
  const effectiveRate =
    rate ?? (provider.name === "KERNEL" || provider.name === "KERNEL_HEADFUL" ? 10 : undefined);
  const minIntervalMs = effectiveRate ? (60 / effectiveRate) * 1000 : 0;

  console.error(
    `\n[CONFIG] benchmark=browser-throughput provider=${provider.name} concurrency=${concurrency} runs=${runs} loops=${loops}`
  );
  if (effectiveRate) {
    console.error(`[RATE_LIMIT] Throttling to ${effectiveRate} sessions/min (${(minIntervalMs / 1000).toFixed(1)}s interval)`);
  }

  const write = (record: BrowserThroughputRecord) =>
    fs.appendFileSync(out, JSON.stringify(record) + "\n", { encoding: "utf-8" });

  // Warm-ups are written too, flagged, so cold-start numbers are not thrown
  // away. Session slots 0..WARMUP_RUNS-1 belong to them.
  for (let i = 1; i <= WARMUP_RUNS; i++) {
    const start = Date.now();
    console.error(`[WARMUP] ${i}/${WARMUP_RUNS}`);
    const slot = i - 1;
    write(
      await runSingleSession(provider, {
        concurrency,
        loops,
        urlForLoop: (loop) => urlFor(slot, loop - 1),
        actionTimeoutMs,
        warmup: true,
        coldStart: i === 1,
      })
    );
    await throttle(start, minIntervalMs);
  }

  let success = 0;
  let failure = 0;
  const batches = Math.max(1, Math.ceil(runs / concurrency));
  let slot = WARMUP_RUNS;
  let remaining = runs;

  for (let b = 1; b <= batches; b++) {
    const start = Date.now();
    // The last batch is only as wide as the sessions left, so `runs` is exact.
    const width = Math.min(concurrency, remaining);
    remaining -= width;
    console.error(`[RUN] batch ${b}/${batches} (c=${concurrency}, sessions=${width})`);

    const batch = Array.from({ length: width }, () => {
      const s = slot++;
      return runSingleSession(provider, {
        concurrency,
        loops,
        urlForLoop: (loop) => urlFor(s, loop - 1),
        actionTimeoutMs,
      });
    });
    const records = await Promise.all(batch);

    for (const record of records) {
      write(record);
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
