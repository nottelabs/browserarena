import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getMissingEnvVarsForProvider, resolveProvider } from "./providers/index.js";
import { runLoop as runHelloBrowser } from "./benchmarks/hello-browser/run.js";
import { runRecordedSession } from "./benchmarks/hello-browser/record.js";
import { runLoop as runV0 } from "./benchmarks/v0/run.js";
import { phaseExtract, phaseCrawl, phaseForm } from "./benchmarks/v0/phases.js";
import { getArg } from "./utils/arg.js";
import { collectVmMeta } from "./utils/vm-meta.js";
import { sanitizeErrorMessage } from "./utils/sanitize.js";
import { createHash, randomUUID } from "node:crypto";
import { runProxyGetSuite } from "./benchmarks/proxy-get/run.js";
import { parseCountries } from "./benchmarks/proxy-get/schema.js";
import { loadProxyPricing } from "./benchmarks/proxy-get/pricing.js";
import { PAYLOAD_BYTES, PAYLOAD_SHA256 } from "./benchmarks/proxy-get/payload.js";
import { validateProxyGetUrls } from "./benchmarks/proxy-get/validate.js";
import { writeProxyResultsIndex } from "./benchmarks/proxy-get/manifest.js";
import { proxySuiteOutput, readProxyResults } from "./benchmarks/proxy-get/output.js";
import { runLoop as runBrowserThroughput, WARMUP_RUNS as BROWSER_THROUGHPUT_WARMUPS } from "./benchmarks/browser-throughput/run.js";
import { resolveArticleUrls, type ArticleSource } from "./benchmarks/browser-throughput/articles.js";

type BenchmarkName = "hello-browser" | "v0" | "proxy-get" | "browser-throughput";

const DEFAULT_PROVIDERS =
  "browserbase,steel,kernel,kernel-headful,notte,hyperbrowser,anchorbrowser,browser-use,lightpanda";

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some(
    (a) => a === `--${name}` || a.startsWith(`--${name}=`)
  );
}

function startLogging(logPath: string): () => void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const stream = fs.createWriteStream(logPath, { flags: "w", encoding: "utf-8" });
  const originalError = console.error;

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    stream.write(sanitizeErrorMessage(line) + "\n");
  };

  return () => {
    console.error = originalError;
    stream.end();
  };
}

async function main() {
  if (hasFlag("help")) {
    console.log(`Usage: npm run bench -- --benchmark=hello-browser|v0|proxy-get|browser-throughput --provider=steel,kernel,...
Common: --runs=N --out=PATH --rate=SESSIONS_PER_MINUTE --url=URL --concurrency=1,10 --record
browser-throughput: --loops=N (10 actions per loop) --articles=fixed|random --action-timeout=MS
Proxy GET: --countries=US,FR,BR,IN,JP (50 runs/country by default; sequential fresh sessions)
  --preflight (check credentials and endpoints without sessions)
  --run-id=ID (resume a suite up to the cumulative --runs target)
  --bootstrap-url=URL --country-url=URL --timeout-ms=30000 --pricing=CONFIG.json
  Custom payloads require --expected-bytes=N --expected-sha256=HEX
  Defaults to the controlled /api/proxy-get/payload endpoint on www.browserarena.ai.`);
    return;
  }
  const record = hasFlag("record");
  const benchmarkArg = getArg(
    "benchmark",
    process.env.BENCHMARK || "hello-browser"
  )! as BenchmarkName;
  if (!["hello-browser", "v0", "proxy-get", "browser-throughput"].includes(benchmarkArg)) throw new Error(`Unknown benchmark: ${benchmarkArg}`);
  const providerArg = getArg(
    "provider",
    process.env.PROVIDER || (benchmarkArg === "proxy-get" ? `${DEFAULT_PROVIDERS},tilion` : DEFAULT_PROVIDERS)
  )!;
  const runs = Number(getArg("runs", process.env.RUNS || (benchmarkArg === "proxy-get" ? "50" : "100")));
  if (!Number.isInteger(runs) || runs <= 0) throw new Error("--runs must be a positive integer");
  const defaultUrl =
    benchmarkArg === "v0"
      ? "https://en.wikipedia.org/wiki/Artificial_intelligence"
      : benchmarkArg === "proxy-get" ? "https://www.browserarena.ai/api/proxy-get/payload" : "https://example.com/";
  const url = getArg("url", process.env.URL || defaultUrl)!;
  const outArg = getArg("out", process.env.OUTPUT || undefined);
  const rateArg = getArg("rate", process.env.RATE || undefined);
  const rate = rateArg ? Number(rateArg) : undefined;
  if (rate !== undefined && (!Number.isFinite(rate) || rate < 1)) throw new Error("--rate must be at least 1 session/minute");
  // browser-throughput only: loops of 10 actions per session, start-page source, per-action timeout.
  const loops = Number(getArg("loops", process.env.LOOPS || "1"));
  if (!Number.isInteger(loops) || loops < 1) throw new Error(`--loops must be a positive integer, got "${getArg("loops", process.env.LOOPS || "1")}"`);
  const articles = getArg("articles", process.env.ARTICLES || "fixed")! as ArticleSource;
  if (articles !== "fixed" && articles !== "random") throw new Error(`--articles must be "fixed" or "random", got "${articles}"`);
  const actionTimeoutArg = getArg("action-timeout", process.env.ACTION_TIMEOUT_MS || undefined);
  const actionTimeoutMs = actionTimeoutArg ? Number(actionTimeoutArg) : undefined;
  const concurrencyArg = getArg("concurrency", process.env.CONCURRENCY || "1");
  const concurrencyLevels = concurrencyArg!
    .split(",")
    .map((c) => Number(c.trim()))
    .filter((c) => c > 0);

  const providerNames = providerArg
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const date = new Date().toISOString().slice(0, 10);
  let providersRun = 0;

  if (benchmarkArg === "proxy-get") {
    if (record) throw new Error("--record is not supported for proxy-get");
    if (hasFlag("concurrency") && concurrencyArg !== "1") throw new Error("proxy-get runs sequentially; --concurrency must be 1");
    if (outArg && providerNames.length !== 1) throw new Error("--out requires exactly one provider for proxy-get");
    const countries = parseCountries(getArg("countries", process.env.PROXY_COUNTRIES || "US,FR,BR,IN,JP")!);
    const runId = getArg("run-id") || randomUUID();
    if (runId && !/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error("--run-id must contain 1–100 letters, digits, underscores or hyphens");
    const target = new URL(url);
    const bootstrapUrl = getArg("bootstrap-url", process.env.PROXY_BOOTSTRAP_URL || `${target.origin}/api/proxy-get/bootstrap`)!;
    const countryUrl = getArg("country-url", process.env.PROXY_COUNTRY_URL || "https://api.country.is/")!;
    validateProxyGetUrls(url, bootstrapUrl, countryUrl);
    const customPayload = target.pathname !== "/api/proxy-get/payload";
    if (customPayload && (!getArg("expected-bytes") || !getArg("expected-sha256"))) {
      throw new Error("Custom payloads require --expected-bytes and --expected-sha256");
    }
    const expectedBytes = Number(getArg("expected-bytes", String(PAYLOAD_BYTES)));
    const expectedSha256 = getArg("expected-sha256", PAYLOAD_SHA256)!.toLowerCase();
    const timeoutMs = Number(getArg("timeout-ms", "30000"));
    if (!Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 16 * 1024 * 1024) throw new Error("Expected bytes must be between 1 and 16 MiB");
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("Expected SHA-256 must contain 64 hex characters");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("Timeout must be between 1 and 120000 ms");
    const pricing = loadProxyPricing(getArg("pricing", process.env.PROXY_PRICING_FILE));
    const providers = providerNames.flatMap(name => {
      const client = resolveProvider(name);
      const missing = getMissingEnvVarsForProvider(name);
      // Unsupported markers require no credentials and never open a session.
      if (missing.length && client.proxyCountries?.some(c => countries.includes(c))) {
        if (hasFlag("preflight")) throw new Error(`${name}: missing ${missing.join(", ")}`);
        console.error(`[SKIP] ${name}: missing ${missing.join(", ")}`);
        return [];
      }
      return [{ client, out: outArg || (hasFlag("preflight")
        ? path.join("results", "proxy-get", name, date, "results.jsonl")
        : proxySuiteOutput(name, runId, date)) }];
    });
    if (!providers.length) throw new Error("No configured providers available for proxy-get");
    // Fail before creating paid sessions if the controlled target isn't deployed.
    if (providers.some(p => p.client.proxyCountries?.some(c => countries.includes(c)))) {
      const preflight = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      if (!preflight.ok) throw new Error(`Payload preflight HTTP ${preflight.status}; deploy the target or set --url`);
      const body = Buffer.from(await preflight.arrayBuffer());
      if (body.length !== expectedBytes || createHash("sha256").update(body).digest("hex") !== expectedSha256) {
        throw new Error("Payload preflight size or SHA-256 mismatch");
      }
      const bootstrap = await fetch(bootstrapUrl, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      if (!bootstrap.ok || !bootstrap.headers.get("content-type")?.includes("text/html")) {
        throw new Error(`Bootstrap preflight HTTP ${bootstrap.status}; expected an HTML document`);
      }
    }
    if (hasFlag("preflight")) { console.log(`[PREFLIGHT] ${providers.length} providers checked; no sessions created`); return; }
    // Validate every destination before replacing metadata or creating sessions.
    for (const provider of providers) readProxyResults(provider.out);
    const options = { url, bootstrapUrl, countryUrl, expectedBytes, expectedSha256, timeoutMs, countries, runs, rate, runId };
    const vmMeta = await collectVmMeta();
    const startedAt = new Date().toISOString();
    const writeMeta = (finishedAt: string) => {
      for (const provider of providers) {
        fs.mkdirSync(path.dirname(provider.out), { recursive: true });
        fs.writeFileSync(path.join(path.dirname(provider.out), "_meta.json"), JSON.stringify({ ...vmMeta,
          started_at: startedAt, finished_at: finishedAt, benchmark: "proxy-get", run_id: runId, ...options }, null, 2) + "\n");
      }
    };
    writeMeta("");
    const stopLogging = startLogging(`logs/proxy-get-${Date.now()}.log`);
    try { await runProxyGetSuite(providers, options, pricing); }
    finally {
      writeMeta(new Date().toISOString());
      if (!outArg) writeProxyResultsIndex();
      stopLogging();
    }
    return;
  }

  if (record) {
    for (const providerName of providerNames) {
      const missing = getMissingEnvVarsForProvider(providerName);
      if (missing.length > 0) {
        console.error(
          `[ERROR] provider=${providerName} skipped: missing env ${missing.join(", ")}`
        );
        continue;
      }
      const provider = resolveProvider(providerName);
      const outDir = `recordings/${benchmarkArg}/${providerName}`;
      if (benchmarkArg === "v0") {
        await runRecordedSession(provider, {
          url,
          outDir,
          onPage: async (page) => {
            console.error(`[RECORD] Phase 1: Extract...`);
            const article = await phaseExtract(page, url);
            console.error(`[RECORD] Extracted "${article.title}" (${article.internalLinks.length} links)`);

            console.error(`[RECORD] Phase 2: Crawl...`);
            const crawled = await phaseCrawl(page, article.internalLinks);
            console.error(`[RECORD] Crawled ${crawled.length} pages`);

            console.error(`[RECORD] Phase 3: Form...`);
            const confirmed = await phaseForm(page, article, crawled);
            console.error(`[RECORD] Form confirmed=${confirmed}`);
          },
        });
      } else {
        await runRecordedSession(provider, { url, outDir });
      }
      providersRun += 1;
    }
    if (providersRun === 0 && providerNames.length > 0) {
      console.error("[WARN] No providers ran (all skipped or invalid).");
    }
    return;
  }

  const meta = await collectVmMeta();

  // One start-page assignment per command, shared by every provider and
  // concurrency level, so they all walk the same pages even when a random
  // pool is in use or the run crosses midnight.
  const urlFor =
    benchmarkArg === "browser-throughput"
      ? await resolveArticleUrls(articles, runs + BROWSER_THROUGHPUT_WARMUPS, loops, new Date())
      : null;

  for (const providerName of providerNames) {
    const missing = getMissingEnvVarsForProvider(providerName);
    if (missing.length > 0) {
      console.error(
        `[ERROR] provider=${providerName} skipped: missing env ${missing.join(", ")}`
      );
      continue;
    }
    const provider = resolveProvider(providerName);
    let out: string;

    let logPath: string;
    let metaPath: string;
    const runDir = `results/${benchmarkArg}/${providerName}/${date}`;
    out = outArg || `${runDir}/results.jsonl`;
    logPath = `${runDir}/results.log`;
    metaPath = `${runDir}/_meta.json`;
    fs.mkdirSync(runDir, { recursive: true });

    const providerMeta = { ...meta, started_at: new Date().toISOString(), finished_at: "" };
    fs.writeFileSync(metaPath, JSON.stringify(providerMeta, null, 2) + "\n", "utf-8");
    console.error(`[META] Wrote ${metaPath}`);

    const stopLogging = startLogging(logPath);
    console.error(`[LOG] Saving logs to ${logPath}`);

    try {
      if (benchmarkArg === "hello-browser") {
        for (const concurrency of concurrencyLevels) {
          const concOut = out.replace(/results\.jsonl$/, `c${concurrency}/results.jsonl`);
          fs.mkdirSync(path.dirname(concOut), { recursive: true });
          const batches = Math.max(1, Math.ceil(runs / concurrency));
          await runHelloBrowser(provider, { runs: batches, url, out: concOut, rate, concurrency });
        }
      } else if (benchmarkArg === "browser-throughput") {
        for (const concurrency of concurrencyLevels) {
          const concOut = out.replace(/results\.jsonl$/, `c${concurrency}/results.jsonl`);
          fs.mkdirSync(path.dirname(concOut), { recursive: true });
          await runBrowserThroughput(provider, { runs, out: concOut, rate, concurrency, loops, urlFor: urlFor!, actionTimeoutMs });
        }
      } else {
        for (const concurrency of concurrencyLevels) {
          await runV0(provider, { runs, url, out, rate, concurrency });
        }
      }
    } finally {
      providerMeta.finished_at = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(providerMeta, null, 2) + "\n", "utf-8");
      stopLogging();
    }
    providersRun += 1;
  }

  if (providersRun === 0 && providerNames.length > 0) {
    console.error("[WARN] No providers ran (all skipped or invalid).");
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[FATAL] ${e?.stack || e?.message || e}`);
    process.exit(1);
  });
