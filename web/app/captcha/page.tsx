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
        <nav className={styles.campaigns} aria-label="CAPTCHA campaigns">
          {campaigns.map(item => <Link key={item.id} href={`/captcha?campaign=${item.id}`} aria-current={item.id === campaign.id ? "page" : undefined}>
            {item.id}{!item.complete ? " (partial)" : ""}
          </Link>)}
        </nav>
        <ul className={styles.meta} aria-label="Campaign details">
          <li>{campaign.rounds} planned attempts per provider and CAPTCHA type</li>
          <li>180-second solve window</li>
          <li>Protocol v3</li>
          <li>Started {campaign.started_at.slice(0, 16).replace("T", " ")} UTC</li>
          <li>{campaign.attempts.length} of {campaign.providers.length * campaign.rounds * 3} attempts recorded</li>
        </ul>
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
                const rate = cell.attempted ? count / cell.attempted : 0;
                const rows = campaign.attempts.filter(row => row.provider === provider && row.type === cell.type).sort((a, b) => a.round - b.round);
                return <td key={cell.type} data-rate={rate === 1 ? "full" : rate === 0 ? "zero" : "partial"}>
                  <div className={styles.score}>
                    <strong aria-label={`${names[provider]} ${titles[cell.type]}: ${count} of ${cell.attempted} ${delivery ? "delivered" : "accepted"}`}>{count}/{cell.attempted}</strong>
                    {median !== null && <span className={styles.time}>{(median / 1000).toFixed(1)}s</span>}
                  </div>
                  <ol className={styles.rounds} aria-label="Rounds">{rows.map(row => {
                    const label = `Round ${row.round}: ${outcomes[row.status]}${row.status === "error" ? ` during ${row.stage}` : ""}${row.cleanup_failed ? "; cleanup failed" : ""}`;
                    return <li key={row.id} data-outcome={row.status} title={label} aria-label={label} />;
                  })}{Array.from({ length: cell.not_run }, (_, index) => <li key={`not-run-${index}`} data-outcome="not_run" title="Not run" aria-label="Not run" />)}</ol>
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
