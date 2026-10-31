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
        <p className={styles.context}>{campaign.rounds} planned attempts per provider and CAPTCHA type · 180-second solve window · Protocol v3</p>
        <p className={styles.context}>Started {campaign.started_at.replace("T", " ").replace(".000Z", " UTC")} · {campaign.attempts.length} of {campaign.providers.length * campaign.rounds * 3} attempts recorded</p>
        {(!campaign.complete || campaign.halted || campaign.interrupted) && <p className={styles.notice} role="status">
          {campaign.halted ? "Campaign halted. " : campaign.interrupted ? "Campaign interrupted. " : "Partial campaign. "}
          Unrun attempts stay visible; cleanup failures are reported separately from challenge outcomes.
        </p>}
        <div className={styles.tableScroll} role="region" aria-label="Provider CAPTCHA results" tabIndex={0}>
          <table className={styles.table}>
            <caption>Outcomes per attempted session. Expand a result to inspect every round.</caption>
            <thead><tr><th scope="col">Provider</th>{Object.entries(titles).map(([type, title]) => <th scope="col" key={type}>{title}<span>{type === "hcaptcha" ? "Token delivery only" : "Server acceptance"}</span></th>)}</tr></thead>
            <tbody>{campaign.providers.map(provider => <tr key={provider}>
              <th scope="row">{names[provider]}</th>
              {cells.filter(cell => cell.provider === provider).map(cell => {
                const delivery = cell.type === "hcaptcha";
                const count = delivery ? cell.token_delivered : cell.verified;
                const interval = delivery ? cell.delivery_interval_95 : cell.acceptance_interval_95;
                const median = delivery ? cell.delivered_median_ms : cell.accepted_median_ms;
                return <td key={cell.type}><details>
                  <summary aria-label={`${names[provider]} ${titles[cell.type]}: ${count} of ${cell.attempted} ${delivery ? "delivered" : "accepted"}`}>
                    <strong>{count}/{cell.attempted}</strong> {delivery ? "delivered" : "accepted"}
                  </summary>
                  <ol className={styles.rounds}>{campaign.attempts.filter(row => row.provider === provider && row.type === cell.type).sort((a, b) => a.round - b.round).map(row => <li key={row.id}>
                    Round {row.round}: {outcomes[row.status]}{row.status === "error" ? ` during ${row.stage}` : ""}{row.cleanup_failed ? "; cleanup failed" : ""}
                  </li>)}</ol>
                </details>
                  <span className={styles.stat}>{interval ? `${Math.round(interval[0] * 100)}–${Math.round(interval[1] * 100)}% interval (95%)` : "No attempts"}</span>
                  {median !== null && <span className={styles.stat}>{(median / 1000).toFixed(1)}s median on {delivery ? "delivery" : "acceptance"}</span>}
                  {cell.not_run > 0 && <span className={styles.stat}>{cell.not_run} not run</span>}
                  {cell.cleanup_errors > 0 && <span className={styles.stat}>{cell.cleanup_errors} cleanup failure{cell.cleanup_errors === 1 ? "" : "s"}</span>}
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <p className={styles.context}>Errors count in the denominator. Times include navigation and only successful outcomes. Small samples are exploratory; they do not establish a speed ranking.</p>
        <a className={styles.link} href={`/api/captcha?campaign=${campaign.id}`}>View campaign JSON</a>
      </> : <div className={styles.empty}>
        <h2>No CAPTCHA campaigns published yet</h2>
        <p>The benchmark is ready for opt-in trials across Kernel, Browserbase, Browser Use, Steel and Notte. Results will appear here after a campaign is run and its export is reviewed.</p>
        <a className={styles.link} href="https://github.com/nottelabs/browserarena/blob/main/docs/captcha.md">Run a campaign</a>
      </div>}
      <section className={styles.method} aria-labelledby="measurement-title">
        <h2 id="measurement-title">What these results measure</h2>
        <p>Turnstile and reCAPTCHA require an independently observed server acceptance. hCaptcha uses NopeCHA’s enterprise demo: delivery means the demo page reports success. Its demo does not verify that token on a server.</p>
        <p>Each attempt uses a fresh 1920 × 1080 session with native solving and the provider’s proxy preset. No warm-ups are discarded and attempts are not retried. Fixtures choose challenge difficulty dynamically, so automatic clearance can count as acceptance. This does not measure visual-puzzle accuracy or Cloudflare’s full interstitial challenge.</p>
      </section>
    </section>
  </BenchmarkShell>;
}
