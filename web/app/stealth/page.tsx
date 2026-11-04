import type { Metadata } from "next";
import { Suspense } from "react";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { BenchmarkTitle } from "@/components/benchmarks/benchmark-title";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import { BenchmarkTablePanel } from "@/components/benchmarks/table-panel";
import styles from "@/components/benchmarks/benchmark.module.css";
import { PROVIDERS_BY_ID } from "@/lib/providers";
import { loadStealthRuns, rankStealth } from "@/lib/stealth";
import pageStyles from "./page.module.css";

export const metadata: Metadata = { title: "Bot Detection", description: "Weekly provider access scores on a fixed sample of difficult websites.", alternates: { canonical: "https://browserarena.ai/stealth" } };

async function Scores({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const runs = loadStealthRuns();
  const run = week ? runs.find(r => r.weekOf === week) : runs[0];
  return <BenchmarkShell benchmark="stealth" date={run?.date}>
    <div className={styles.tableStage}>
      <BenchmarkSectionHeader><BenchmarkTitle name="Bot Detection" date={<p className="text-xs text-muted-foreground">{run ? `Run ${run.date} · Week of ${run.weekOf}` : "Weekly scores"}</p>} /></BenchmarkSectionHeader>
      {runs.length > 0 && <form action="/stealth" method="get" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="score-week">Run history</label>
        <select id="score-week" name="week" defaultValue={run?.weekOf ?? runs[0].weekOf} className="rounded border border-border bg-background px-2 py-1.5 text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          {runs.map(r => <option key={r.weekOf} value={r.weekOf}>{r.date}</option>)}
        </select>
        <button type="submit" className="rounded border border-border px-3 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">View run</button>
      </form>}
      {run ? <BenchmarkTablePanel label="Weekly provider access scores">
        <div className={`${styles.tableScroll} ${pageStyles.scroll}`} tabIndex={0} role="region" aria-label="Provider scores; scroll horizontally for all counts">
          <table className={pageStyles.scores}>
            <caption className="sr-only">Provider access on {run.siteCount} difficult websites, {run.rounds} rounds per provider, run {run.date}.</caption>
            <thead><tr><th scope="col">Provider</th><th scope="col" aria-sort="descending">Access rate</th><th scope="col">Passed</th><th scope="col">Blocked</th><th scope="col">Errors</th></tr></thead>
            <tbody>{rankStealth(run).map(row => <tr key={row.provider}>
              <th scope="row">{PROVIDERS_BY_ID[row.provider]?.displayName ?? row.provider}</th>
              <td>{row.rate === null ? "N/A" : `${Math.round(row.rate * 100)}%`}</td>
              <td>{row.accessible}/90</td><td>{row.blocked}</td><td>{row.errors}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </BenchmarkTablePanel> : <div className="max-w-2xl space-y-2 py-8">
        <h3 className="text-lg font-medium">{runs.length > 0 ? "This run is unavailable" : "First verified run pending"}</h3>
        <p className="text-sm text-muted-foreground">{runs.length > 0 ? "Choose an available date from the run history." : "Provider scores will appear after the first complete weekly benchmark is verified. No scores have been published yet."}</p>
      </div>}
      <div className="mt-6 max-w-3xl space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h3 className="font-medium text-foreground">How to read these scores</h3>
        <p>Each provider makes three visits to the same 30 difficult websites, using its defaults, a US proxy and its own CAPTCHA handling. A visit passes when it completes a short journey with no known blocking page remaining. These scores measure access on a deliberately difficult sample and do not represent general browsing reliability.</p>
        <p>Access rate is passed visits divided by passed plus blocked visits. Errors are reported separately and excluded from that rate. Each provider has 90 planned visits. Results are published weekly after a complete run; the date above identifies the actual measurement. Missing updates leave the last verified run visible.</p>
        <p>This page publishes aggregate scores only. Website lists, individual visits and recordings are not distributed here. Protocol: site-access-1.</p>
      </div>
    </div>
  </BenchmarkShell>;
}

export default function StealthPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <Suspense fallback={<BenchmarkPending />}><Scores searchParams={searchParams} /></Suspense>;
}
