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

type BenchmarkName = "hello-browser" | "v0";

const DEFAULT_PROVIDERS =
  "browserbase,steel,kernel,kernel-headful,notte,hyperbrowser,anchorbrowser,browser-use";

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
  const record = hasFlag("record");
  const benchmarkArg = getArg(
    "benchmark",
    process.env.BENCHMARK || "hello-browser"
  )! as BenchmarkName;
  const providerArg = getArg(
    "provider",
    process.env.PROVIDER || DEFAULT_PROVIDERS
  )!;
  const runs = Number(getArg("runs", process.env.RUNS || "1000"));
  const defaultUrl =
    benchmarkArg === "v0"
      ? "https://en.wikipedia.org/wiki/Artificial_intelligence"
      : "https://example.com/";
  const url = getArg("url", process.env.URL || defaultUrl)!;
  const outArg = getArg("out", process.env.OUTPUT || undefined);
  const rateArg = getArg("rate", process.env.RATE || undefined);
  const rate = rateArg ? Number(rateArg) : undefined;
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
          await runHelloBrowser(provider, { runs, url, out: concOut, rate, concurrency });
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
