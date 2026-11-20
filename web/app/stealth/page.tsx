import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { BENCHMARK_TITLES, BenchmarkTitle } from "@/components/benchmarks/benchmark-title";
import { RunDatePicker } from "@/components/benchmarks/run-date-picker";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import { BenchmarkTablePanel } from "@/components/benchmarks/table-panel";
import styles from "@/components/benchmarks/benchmark.module.css";
import { PROVIDER_LOGO_SRC } from "@/lib/provider-logos";
import { PROVIDERS_BY_ID, providerPath } from "@/lib/providers";
import { loadStealthRuns, rankStealth, STEALTH_SITES } from "@/lib/stealth";
import pageStyles from "./page.module.css";

export const metadata: Metadata = { title: "Bot Detection", description: "Weekly provider access scores on a fixed sample of difficult websites.", alternates: { canonical: "https://browserarena.ai/stealth" } };

const utc = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${date}T00:00:00Z`));
const longDate = (date: string) => utc(date, { day: "numeric", month: "long", year: "numeric" });
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const OUTCOMES = ["accessible", "blocked", "errors"] as const;
const SHARES = [["blocked", "Blocked"], ["errors", "Errors"]] as const;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const Key = ({ outcome, children }: { outcome: typeof OUTCOMES[number]; children: string }) =>
  <span className={pageStyles.key}><i data-outcome={outcome} aria-hidden="true" />{children}</span>;

async function Scores({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const runs = loadStealthRuns();
  const run = week ? runs.find(r => r.weekOf === week) : runs[0];
  const planned = run ? run.siteCount * run.rounds : 90;
  return <BenchmarkShell benchmark="stealth" date={run?.date}>
    <div className={styles.tableStage}>
      <BenchmarkSectionHeader controls={run && <p>
        {run === runs[0] ? "Latest run" : "Run on"} <strong className="font-semibold text-foreground">{longDate(run.date)}</strong> · week of {utc(run.weekOf, { day: "numeric", month: "long" })} · {run.siteCount} difficult websites · {run.proxyCountry} proxy
      </p>}>
        <BenchmarkTitle name={BENCHMARK_TITLES.stealth} date={run
          ? <RunDatePicker dates={[]} selectedDate={run.weekOf} runs={runs.map(r => ({ value: r.weekOf, label: shortDate(r.date) }))} param="week" benchmark="bot-detection" pathname="/stealth" />
          : <p className="text-xs text-muted-foreground">Weekly scores</p>} />
      </BenchmarkSectionHeader>
      {run ? <BenchmarkTablePanel label="Weekly provider access scores">
        <div className={`${styles.tableScroll} ${pageStyles.scroll}`} tabIndex={0} role="region" aria-label="Provider scores; scroll horizontally for all counts">
          <table className={pageStyles.scores}>
            <caption className="sr-only">Provider access on {run.siteCount} difficult websites, run {run.date}. Ranked by access rate.</caption>
            <thead><tr>
              <th scope="col">#</th>
              <th scope="col">Provider</th>
              <th scope="col" data-sorted="" aria-sort="descending"><Key outcome="accessible">Access rate</Key></th>
              <th scope="col" aria-hidden="true">Visits</th>
              {SHARES.map(([key, label]) => <th key={key} scope="col"><Key outcome={key}>{label}</Key></th>)}
            </tr></thead>
            <tbody>{rankStealth(run).map((row, index) => {
              const name = PROVIDERS_BY_ID[row.provider]?.displayName ?? row.provider;
              const logo = PROVIDER_LOGO_SRC[row.provider];
              const path = providerPath(row.provider);
              const label = <>
                {logo && <span className={`inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[3px] ${row.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}><img src={logo} decoding="sync" className="size-full object-contain" alt="" /></span>}
                <span className="leading-4">{name}</span>
              </>;
              return <tr key={row.provider} data-leader={index === 0 ? "" : undefined}>
                <td>{index + 1}</td>
                <th scope="row">{path
                  ? <Link href={path} prefetch={true} className="flex w-fit items-center gap-2 hover:underline">{label}</Link>
                  : <span className="flex items-center gap-2">{label}</span>}</th>
                <td data-sorted="">{percent(row.rate)}</td>
                {/* The rates beside it carry the same split, so the bar is decorative for assistive tech. */}
                <td aria-hidden="true"><span className={pageStyles.bar}>
                  {OUTCOMES.map(key => row[key] > 0 && <i key={key} data-outcome={key} style={{ flexGrow: row[key] }} />)}
                </span></td>
                {SHARES.map(([key]) => <td key={key}>{percent(row[key] / planned)}</td>)}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </BenchmarkTablePanel> : <div data-benchmark-panel="empty" className="p-6">
        <h3 className="text-base font-semibold">{runs.length > 0 ? "This run is unavailable" : "First verified run pending"}</h3>
        <p className="mt-3 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">{runs.length > 0 ? "No scores were published for that week." : "Provider scores will appear after the first complete weekly benchmark is verified. No scores have been published yet."}</p>
        {runs.length > 0 && <Link data-control href="/stealth" className="mt-4 rounded-[3px] border border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground">View the latest run</Link>}
      </div>}
    </div>
    <section aria-labelledby="stealth-method">
      <h2 id="stealth-method" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How to read these scores</h2>
      <dl className={pageStyles.method}>
        <div>
          <dt>What is measured</dt>
          <dd>Each provider visits a fixed set of 30 websites known for aggressive bot protection, several times per run, with its default configuration, a US proxy and its own CAPTCHA handling. Every visit carries out a short interaction with the site, the way a real user would.</dd>
        </div>
        <div>
          <dt>How the score is computed</dt>
          <dd>A visit only counts as accessed if the site keeps serving its real content through the whole interaction, judged against the challenge and block pages it is known to show. Access, block and error rates are each a share of all planned visits; a visit that fails for technical reasons counts as an error, not a block.</dd>
        </div>
        <div>
          <dt>What is published</dt>
          <dd>Results are published weekly after a complete run; the run date identifies the actual measurement. Missing updates leave the last verified run visible. This page publishes aggregate scores only; individual visits and recordings are kept private.</dd>
        </div>
      </dl>
      <p className={pageStyles.note}>These scores measure access on a deliberately difficult sample and do not represent general browsing reliability.</p>
    </section>
    <section aria-labelledby="stealth-sites" className={pageStyles.siteSection}>
      <h2 id="stealth-sites" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">The {STEALTH_SITES.length} websites</h2>
      <ul className={pageStyles.sites}>{STEALTH_SITES.map(([name, domain]) => <li key={domain}><span className={pageStyles.site}><img src={`/site-icons/${domain}.webp`} width={20} height={20} loading="lazy" decoding="async" alt="" />{name}</span><span className={pageStyles.domain}>{domain}</span></li>)}</ul>
    </section>
  </BenchmarkShell>;
}

export default function StealthPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <Suspense fallback={<BenchmarkPending />}><Scores searchParams={searchParams} /></Suspense>;
}
