import type { Metadata } from "next";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import { BENCHMARK_TITLES, BenchmarkTitle } from "@/components/benchmarks/benchmark-title";
import { BenchmarkTablePanel } from "@/components/benchmarks/table-panel";
import styles from "@/components/benchmarks/benchmark.module.css";
import { PROVIDERS_BY_ID } from "@/lib/providers";
import { loadStealth, rankStealth } from "@/lib/stealth";

export const metadata: Metadata = {
  title: "Stealth",
  description:
    "How often cloud browser providers get through short journeys on bot-protected sites, using each provider's defaults with a US proxy and its captcha solver enabled.",
  alternates: {
    canonical: "https://browserarena.ai/stealth",
  },
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

export default function StealthPage() {
  const summary = loadStealth();
  const rows = rankStealth(summary.providers);
  const visits = summary.sites * summary.rounds;
  return (
    <BenchmarkShell benchmark="stealth" date={summary.date}>
      <div id="leaderboard" className={`${styles.tableStage} scroll-mt-20`}>
        <BenchmarkSectionHeader>
          <BenchmarkTitle
            name={BENCHMARK_TITLES.stealth}
            date={<p className="text-[0.72rem] text-muted-foreground">Run {summary.date}</p>}
          />
        </BenchmarkSectionHeader>
        <BenchmarkTablePanel label="Stealth provider results">
          <div className={styles.tableScroll}>
            <table className="w-full text-left text-[0.78rem] tabular-nums" style={{ minWidth: 760 }}>
              <caption className="sr-only">Access rate per provider on {summary.sites} bot-protected sites, {summary.rounds} rounds, run {summary.date}. Ranked by access rate.</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Provider</th>
                  <th scope="col" data-sorted="" aria-sort="descending">Access rate</th>
                  <th scope="col">95% interval</th>
                  <th scope="col">Got through</th>
                  <th scope="col">Blocked</th>
                  <th scope="col">Errors</th>
                  <th scope="col">Sites reached</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const info = PROVIDERS_BY_ID[row.provider];
                  return (
                    <tr key={row.provider} data-leader={index === 0 ? "" : undefined}>
                      <td>{index + 1}</td>
                      <th scope="row">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {info?.logo && (
                            <span className={`inline-flex size-6 items-center justify-center overflow-hidden rounded-[3px] ${row.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}>
                              <img src={info.logo} decoding="sync" className="size-full object-contain" alt="" />
                            </span>
                          )}
                          <span className="leading-4">{info?.displayName ?? row.provider}</span>
                        </span>
                      </th>
                      <td data-sorted="">{row.accessRate === null ? "N/A" : percent(row.accessRate)}</td>
                      <td>{row.interval ? `${percent(row.interval[0])} to ${percent(row.interval[1])}` : "N/A"}</td>
                      <td>{row.accessible}/{visits}</td>
                      <td>{row.blocked}</td>
                      <td>{row.errors}</td>
                      <td>{row.sitesAccessed}/{summary.sites}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </BenchmarkTablePanel>
        <div className="mt-4 max-w-3xl space-y-2 text-[0.78rem] text-muted-foreground">
          <p>
            Each visit opens a bot-protected site and makes one or two clicks, or follows a short sign-in path, then stops. A visit gets through when it reaches the last step with no challenge left on the page. Each provider runs with its own defaults, a US proxy and its captcha solver enabled; the harness never solves challenges itself.
          </p>
          <p>
            Access rate is visits that got through divided by visits that got through or were blocked. Errors (session or connection failures, or a page that changed so a step no longer applies) are reported but not counted. {summary.sites} sites, {summary.rounds} rounds, run from {summary.region}. The sites were chosen to be hard, so these rates are not representative of general browsing.
          </p>
        </div>
      </div>
    </BenchmarkShell>
  );
}
