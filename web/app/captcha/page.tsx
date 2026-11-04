import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { loadCaptchaCampaigns } from "@/lib/captcha-data";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { campaignCells } from "../../../src/benchmarks/captcha/publication";
import styles from "./captcha.module.css";

export const metadata: Metadata = {
  title: "CAPTCHA Handling",
  description: "Fresh-session trials of native CAPTCHA handling across cloud browser providers. Server acceptance and token delivery reported separately.",
  alternates: { canonical: "https://browserarena.ai/captcha" },
};
const names: Record<string, string> = { kernel: "Kernel", browserbase: "Browserbase", "browser-use": "Browser Use", steel: "Steel", notte: "Notte" };
const titles: Record<string, string> = { turnstile: "Cloudflare Turnstile", recaptcha: "reCAPTCHA v2", hcaptcha: "hCaptcha" };
const SOLVE_WINDOW_SECONDS = 180;
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
const outcomes: Record<string, string> = { verified: "Accepted", token_delivered: "Token delivered", timeout: "Timed out", rejected: "Rejected", error: "Error", interrupted: "Interrupted" };

export default function CaptchaPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  return <Suspense fallback={<BenchmarkPending />}><Content searchParams={searchParams} /></Suspense>;
}
async function Content({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const { campaign } = await searchParams;
  return <CampaignView selected={campaign ?? ""} />;
}
async function CampaignView({ selected }: { selected: string }) {
  "use cache";
  cacheLife(BENCHMARK_CACHE_LIFE);
  const campaigns = await loadCaptchaCampaigns();
  const campaign = selected ? campaigns.find(item => item.id === selected) : campaigns[0];
  if (selected && !campaign) notFound();
  const cells = campaign ? campaignCells(campaign) : [];
  return <BenchmarkShell benchmark="captcha">
    <section className={styles.content} aria-labelledby="captcha-title">
      <header className={styles.header}>
        <div><h1 id="captcha-title">CAPTCHA Handling</h1>
          <p>Can a fresh browser session get through the challenge? Compare native provider handling across three public fixtures.</p></div>
        <a className={styles.link} href="https://github.com/nottelabs/browserarena/blob/main/docs/captcha.md">Methodology</a>
      </header>
      {campaign ? <>
        <p className={styles.summary}>
          Latest run <strong>{formatDate(campaign.started_at)}</strong> · {campaign.rounds} fresh sessions per provider and CAPTCHA · {SOLVE_WINDOW_SECONDS} seconds to solve each
        </p>
        {campaigns.length > 1 && <p className={styles.runs}>Other runs: {campaigns.filter(item => item.id !== campaign.id).map((item, index) => <span key={item.id}>
          {index > 0 && ", "}<Link href={`/captcha?campaign=${item.id}`}>{formatDate(item.started_at)}{!item.complete ? " (partial)" : ""}</Link></span>)}
        </p>}
        {(!campaign.complete || campaign.halted || campaign.interrupted) && <p className={styles.notice} role="status">
          {campaign.halted ? "Campaign halted. " : campaign.interrupted ? "Campaign interrupted. " : "Partial campaign. "}
          Unrun attempts stay visible; cleanup failures are reported separately from challenge outcomes.
        </p>}
        <div className={styles.tableScroll} role="region" aria-label="Provider CAPTCHA results" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Provider</th>{Object.entries(titles).map(([type, title]) => <th scope="col" key={type}>{title}<span>{type === "hcaptcha" ? "Token delivery only" : "Server acceptance"}</span></th>)}</tr></thead>
            <tbody>{campaign.providers.map(provider => <tr key={provider}>
              <th scope="row">{names[provider]}</th>
              {cells.filter(cell => cell.provider === provider).map(cell => {
                const delivery = cell.type === "hcaptcha";
                const count = delivery ? cell.token_delivered : cell.verified;
                const median = delivery ? cell.delivered_median_ms : cell.accepted_median_ms;
                const rows = campaign.attempts.filter(row => row.provider === provider && row.type === cell.type).sort((a, b) => a.round - b.round);
                return <td key={cell.type}>
                  <div className={styles.score}>
                    <strong aria-label={`${names[provider]} ${titles[cell.type]}: ${count} of ${cell.attempted} ${delivery ? "delivered" : "accepted"}`}>{count}/{cell.attempted}</strong>
                    {median !== null && <span className={styles.time}>{(median / 1000).toFixed(1)}s</span>}
                  </div>
                  <ol className={styles.rounds} aria-label="Rounds">{rows.map(row => {
                    const label = `Round ${row.round}: ${outcomes[row.status]}${row.status === "error" ? ` during ${row.stage}` : ""}${row.cleanup_failed ? "; cleanup failed" : ""}`;
                    return <li key={row.id} data-outcome={row.status} data-label={label} aria-label={label} tabIndex={0} />;
                  })}{Array.from({ length: cell.not_run }, (_, index) => <li key={`not-run-${index}`} data-outcome="not_run" data-label="Not run" aria-label="Not run" tabIndex={0} />)}</ol>
                  {cell.not_run > 0 && <span className={styles.stat}>{cell.not_run} not run</span>}
                  {cell.cleanup_errors > 0 && <span className={styles.stat}>{cell.cleanup_errors} cleanup failure{cell.cleanup_errors === 1 ? "" : "s"}</span>}
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <p className={styles.legend}>One dot per attempt: green succeeded, amber timed out, red failed. Time is the median of successful attempts.</p>
      </> : <div className={styles.empty}>
        <h2>No CAPTCHA campaigns published yet</h2>
        <p>The benchmark is ready for opt-in trials across Kernel, Browserbase, Browser Use, Steel and Notte. Results will appear here after a campaign is run and its export is reviewed.</p>
        <a className={styles.link} href="https://github.com/nottelabs/browserarena/blob/main/docs/captcha.md">Run a campaign</a>
      </div>}
    </section>
  </BenchmarkShell>;
}
