import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { resolveProvider } from "./providers/index.js";
import { runLoop as runHelloBrowser } from "./benchmarks/hello-browser/run.js";
import { runLoop as runV0 } from "./benchmarks/v0/run.js";
import { getArg } from "./utils/arg.js";
import { collectVmMeta } from "./utils/vm-meta.js";

type BenchmarkName = "hello-browser" | "v0";

function startLogging(logPath: string): () => void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const stream = fs.createWriteStream(logPath, { flags: "w", encoding: "utf-8" });
  const originalError = console.error;

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    stream.write(line + "\n");
  };

  return () => {
    console.error = originalError;
    stream.end();
  };
}

async function main() {
  const benchmarkArg = getArg(
    "benchmark",
    process.env.BENCHMARK || "hello-browser"
  )! as BenchmarkName;
  const providerArg = getArg(
    "provider",
    process.env.PROVIDER || "browserbase"
  )!;
  const runs = Number(getArg("runs", process.env.RUNS || "1000"));
  const url = getArg("url", process.env.URL || "https://google.com/")!;
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

  // Collect VM metadata once
  const meta = await collectVmMeta();

  for (const providerName of providerNames) {
    const provider = resolveProvider(providerName);
    let out: string;

    // Determine output and log paths
    let logPath: string;
    let metaPath: string;
    const runDir = `results/${benchmarkArg}/${providerName}/${date}`;
    out = outArg || `${runDir}/results.jsonl`;
    logPath = `${runDir}/results.log`;
    metaPath = `${runDir}/_meta.json`;
    fs.mkdirSync(runDir, { recursive: true });

    // Write VM metadata per provider run (started_at now, finished_at after)
    const providerMeta = { ...meta, started_at: new Date().toISOString(), finished_at: "" };
    fs.writeFileSync(metaPath, JSON.stringify(providerMeta, null, 2) + "\n", "utf-8");
    console.error(`[META] Wrote ${metaPath}`);

    const stopLogging = startLogging(logPath);
    console.error(`[LOG] Saving logs to ${logPath}`);

    try {
      if (benchmarkArg === "hello-browser") {
        await runHelloBrowser(provider, { runs, url, out, rate });
      } else {
        for (const concurrency of concurrencyLevels) {
          await runV0(provider, { runs, url, out, rate, concurrency });
        }
      }
    } finally {
      // Update meta with finished_at
      providerMeta.finished_at = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(providerMeta, null, 2) + "\n", "utf-8");
      stopLogging();
    }
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
