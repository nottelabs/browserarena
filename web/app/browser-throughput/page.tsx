import type { Metadata } from "next";
import { loadBrowserThroughputLeaderboard } from "@/lib/browser-throughput-data";
import { BrowserThroughputTable } from "@/components/browser-throughput-table";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import styles from "@/components/benchmarks/benchmark.module.css";

export const metadata: Metadata = {
  title: "Browser Throughput",
  description:
    "Per-action throughput of cloud browser providers inside a running session: navigate, wait, screenshot, read, click, back. Actions per second, per-action percentiles, drift and cost per 1,000 actions.",
  alternates: {
    canonical: "https://browserarena.ai/browser-throughput",
  },
};

export default async function BrowserThroughputPage({
  searchParams,
}: {
  searchParams: Promise<{ concurrency?: string }>;
}) {
  const params = await searchParams;
  const requested = Number(params.concurrency ?? 1);
  let concurrency = Number.isInteger(requested) && requested > 0 ? requested : 1;
  let leaderboard = await loadBrowserThroughputLeaderboard(concurrency);
  const concurrencyLevels = leaderboard.metadata.availableConcurrencyLevels?.length
    ? leaderboard.metadata.availableConcurrencyLevels
    : [1];
  if (!concurrencyLevels.includes(concurrency)) {
    concurrency = concurrencyLevels[0];
    leaderboard = await loadBrowserThroughputLeaderboard(concurrency);
  }
  const { providers } = leaderboard;

  return (
    <BenchmarkShell benchmark="browser-throughput" concurrency={concurrency} concurrencyLevels={concurrencyLevels}>
      <div id="leaderboard" className={`${styles.tableStage} scroll-mt-20`}>
        <p className="mb-4 max-w-3xl text-[0.78rem] sm:text-sm leading-relaxed text-muted-foreground">
          Once a session is up, how fast does each agent step complete? Every session runs a fixed loop of ten
          actions on Wikipedia at a 1920x1080 viewport, each action timed on its own. A session only counts as a
          success when every action succeeded.{" "}
          <a
            href="https://github.com/nottelabs/browserarena/blob/main/docs/browser-throughput.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            Methodology
          </a>
          .
        </p>
        {providers.length > 0 ? (
          <div className="reveal-up">
            <BrowserThroughputTable
              data={providers}
              controls={
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Benchmark</h2>
                  <p className="mt-1 text-[0.72rem] text-muted-foreground">
                    Browser Throughput · {concurrency === 1 ? "Sequential runs" : `Concurrent runs · c = ${concurrency}`}
                  </p>
                </div>
              }
            />
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No browser-throughput results yet. Run{" "}
            <code className="font-mono">npm run bench -- --benchmark=browser-throughput</code> to generate data.
          </div>
        )}
      </div>
    </BenchmarkShell>
  );
}
