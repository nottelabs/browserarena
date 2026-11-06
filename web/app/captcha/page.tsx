import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { BENCHMARK_TITLES, BenchmarkTitle } from "@/components/benchmarks/benchmark-title";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import { RunDatePicker } from "@/components/benchmarks/run-date-picker";
import { CaptchaLeaderboard, CaptchaRuns } from "@/components/benchmarks/captcha-leaderboard";
import styles from "@/components/benchmarks/benchmark.module.css";
import { CAPTCHA_TYPES, CAPTCHA_UNSUPPORTED_PROVIDERS, captchaProviderNotes, loadCaptchaCampaigns } from "@/lib/captcha-data";
import { captchaColumns, captchaLeaderboard } from "@/lib/captcha-leaderboard";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { numberToWord } from "@/lib/providers";
import { campaignCells } from "../../../src/benchmarks/captcha/publication";

export const metadata: Metadata = {
  title: "CAPTCHA Handling",
  description: "Fresh-session trials of native CAPTCHA handling across cloud browser providers. Server acceptance and token delivery reported separately.",
  alternates: { canonical: "https://browserarena.ai/captcha" },
};
const METHODOLOGY = "https://github.com/nottelabs/browserarena/blob/main/docs/captcha.md";
const SOLVE_WINDOW_SECONDS = 180;
const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
const shortDate = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const linkClass = "rounded-[3px] border border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground";

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
  if (!campaign) return <BenchmarkShell benchmark="captcha">
    <div className={styles.tableStage}>
      <BenchmarkSectionHeader><BenchmarkTitle name={BENCHMARK_TITLES.captcha} /></BenchmarkSectionHeader>
      <div data-benchmark-panel="empty" className="p-6">
        <h2 className="text-base font-semibold">No CAPTCHA campaigns published yet</h2>
        <p className="mt-3 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">The benchmark is ready for opt-in trials of every provider with a native CAPTCHA solver. Results will appear here after a campaign is run and its export is reviewed.</p>
        <a data-control href={METHODOLOGY} className={`mt-4 ${linkClass}`}>Run a campaign</a>
      </div>
    </div>
  </BenchmarkShell>;

  const cells = campaignCells(campaign);
  const columns = captchaColumns(cells, CAPTCHA_TYPES);
  const rows = captchaLeaderboard(campaign, cells, columns, CAPTCHA_UNSUPPORTED_PROVIDERS, captchaProviderNotes(campaign, campaigns));
  const latest = campaign.id === campaigns[0].id;
  const runLabel = (item: (typeof campaigns)[number]) => {
    const sameDay = campaigns.filter(other => shortDate(other.started_at) === shortDate(item.started_at)).length > 1;
    return `${shortDate(item.started_at)}${sameDay ? ` · ${item.id}` : ""}${item.complete ? "" : " (partial)"}`;
  };
  const runs = campaigns.map(item => ({
    id: item.id, label: runLabel(item), rounds: item.rounds, providers: item.providers.length,
    attempts: item.attempts.length, planned: campaignCells(item).reduce((sum, cell) => sum + cell.planned, 0),
    status: item.halted ? "Halted" : item.interrupted ? "Interrupted" : item.complete ? "Complete" : "Partial",
    href: item.id === campaigns[0].id ? "/captcha" : `/captcha?campaign=${encodeURIComponent(item.id)}`,
  }));
  const deliveryTypes = columns.filter(column => column.signal === "delivery").map(column => column.label);
  return <BenchmarkShell benchmark="captcha">
    {(!campaign.complete || campaign.halted || campaign.interrupted) && <p className="mb-4 text-sm text-muted-foreground" role="status">
      {campaign.halted ? "Campaign halted. " : campaign.interrupted ? "Campaign interrupted. " : "Partial campaign. "}
      Unrun attempts stay visible; cleanup failures are reported separately from challenge outcomes.
    </p>}
    <CaptchaLeaderboard columns={columns} rows={rows}
      caption={`CAPTCHA results for the campaign started ${formatDate(campaign.started_at)}. Ranked by overall success rate, then median time of successful attempts.`}
      dateControl={<RunDatePicker dates={[]} selectedDate={campaign.id} runs={runs.map(run => ({ value: run.id, label: run.label }))} param="campaign" benchmark="captcha-handling" pathname="/captcha" />}
      summary={<p>{latest ? "Latest run" : "Run on"} <strong className="font-semibold text-foreground">{formatDate(campaign.started_at)}</strong> · {campaign.rounds} fresh sessions per provider and CAPTCHA · {SOLVE_WINDOW_SECONDS} seconds to solve each</p>} />
    <section aria-label="Runs">
      <BenchmarkSectionHeader chart title="Runs" description="Published campaigns, newest first." controls={<div className="flex flex-wrap items-center gap-3">
        <a data-control href={`/api/captcha?campaign=${encodeURIComponent(campaign.id)}`} className={linkClass}>Export results</a>
        <a data-control href={METHODOLOGY} className={linkClass}>Methodology</a>
      </div>} />
      <CaptchaRuns runs={runs} selected={campaign.id} />
    </section>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
      Can a fresh browser session get through the challenge? Compare native provider handling across {numberToWord(columns.length)} public fixtures.
      {" "}One dot per attempt: green succeeded, amber timed out, red failed. Time is the median of successful attempts.
      {deliveryTypes.length > 0 && ` ${deliveryTypes.join(", ")} ${deliveryTypes.length === 1 ? "counts" : "count"} token delivery only, not server acceptance.`}
    </p>
  </BenchmarkShell>;
}
