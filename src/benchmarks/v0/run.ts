import fs from "node:fs";
import { chromium } from "playwright-core";
import type { ProviderClient } from "../../types.js";
import { isoUtcNow, nowNs, msSince } from "../../utils/time.js";
import { sanitizeErrorMessage } from "../../utils/sanitize.js";
import type { V0Record } from "./types.js";
import { phaseExtract, phaseCrawl, phaseForm } from "./phases.js";

const TARGET_URL = "https://en.wikipedia.org/wiki/Artificial_intelligence";

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
    provider: provider.name,
    concurrency,
    success: false,
    error_stage: null,
    error_message: null,
    error_screenshot_path: null,
    session_creation_ms: null,
    session_connect_ms: null,
    session_release_ms: null,
    extract_ms: null,
    crawl_ms: null,
    form_ms: null,
    total_work_ms: null,
    seed_title: null,
    seed_word_count: null,
    pages_visited: null,
    pages_extracted: null,
    total_words_extracted: null,
    total_images_found: null,
    crawled_titles: null,
    cost_usd: null,
  };

  try {
    // --- Session setup ---
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

    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    const agentStart = nowNs();

    // --- Phase 1: Extract ---
    stage = "extract";
    const tExtract = nowNs();
    const article = await phaseExtract(page, url);
    result.extract_ms = msSince(tExtract);
    console.error(
      `[Extract] ${result.extract_ms}ms — "${article.title}" (${article.internalLinks.length} links found)`
    );

    // --- Phase 2: Crawl ---
    stage = "crawl";
    const tCrawl = nowNs();
    const crawled = await phaseCrawl(page, article.internalLinks);
    result.crawl_ms = msSince(tCrawl);
    console.error(
      `[Crawl] ${result.crawl_ms}ms — ${crawled.length} pages: ${crawled.map((c) => c.title).join(", ")}`
    );

    // --- Phase 3: Form ---
    stage = "form";
    const tForm = nowNs();
    const formConfirmed = await phaseForm(page, article, crawled);
    result.form_ms = msSince(tForm);
    console.error(`[Form] ${result.form_ms}ms — confirmed=${formConfirmed}`);

    result.total_work_ms = msSince(agentStart);
    console.error(`[Total] ${result.total_work_ms}ms`);

    if (!formConfirmed) {
      throw new Error("Form submission was not confirmed by httpbin");
    }

    // Populate extracted data summary
    result.seed_title = article.title;
    result.seed_word_count = article.wordCount;
    result.pages_visited = 1 + crawled.length;
    result.pages_extracted = 1 + crawled.filter((c) => c.title.length > 0).length;
    result.total_words_extracted =
      article.wordCount + crawled.reduce((sum, c) => sum + c.wordCount, 0);
    result.total_images_found =
      article.imageCount + crawled.reduce((sum, c) => sum + c.imageCount, 0);
    result.crawled_titles = crawled.map((c) => c.title);

    result.success = true;
  } catch (e: unknown) {
    const message = sanitizeErrorMessage(
      e instanceof Error ? e.stack || e.message : `${e}`
    );
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
      (result.total_work_ms ?? 0) +
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

const WARMUP_RUNS = 3;

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
  const effectiveUrl = url || TARGET_URL;
  const minIntervalMs = rate ? (60 / rate) * 1000 : 0;

  console.error(
    `\n[CONFIG] provider=${provider.name} concurrency=${concurrency} runs=${runs} url=${effectiveUrl}`
  );
  if (rate) {
    console.error(
      `[RATE_LIMIT] Throttling to ${rate} sessions/min (${(minIntervalMs / 1000).toFixed(1)}s interval)`
    );
  }

  for (let i = 1; i <= WARMUP_RUNS; i++) {
    const start = Date.now();
    console.error(`[WARMUP] ${i}/${WARMUP_RUNS}`);
    await runSingleSession(provider, effectiveUrl, concurrency);
    await throttle(start, minIntervalMs);
  }

  let success = 0;
  let failure = 0;

  for (let i = 1; i <= runs; i++) {
    const start = Date.now();
    console.error(`[RUN] ${i}/${runs} (c=${concurrency})`);

    const batch = Array.from({ length: concurrency }, () =>
      runSingleSession(provider, effectiveUrl, concurrency)
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
