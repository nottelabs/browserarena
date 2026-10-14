"use client";
import { track } from "@/lib/analytics";
import { withNotteUtm } from "@/lib/utm";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, SquareMinus, SquarePlus } from "lucide-react";
import { RunInfoIcon } from "@/components/run-info-icon";
import type { ProxyGetStats } from "@/lib/proxy-get";
import { proxyRunCountLabel } from "@/lib/proxy-daily-progress";
import { PROVIDERS_BY_ID, providerPath } from "@/lib/providers";
import { rankProxyValues } from "@/lib/proxy-value-score";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BenchmarkSectionHeader } from "./section-header";
import { BENCHMARK_TITLES, BenchmarkTitle } from "./benchmark-title";
import { BenchmarkTablePanel } from "./table-panel";
import { WeightBar, DEFAULT_PRESET_WEIGHTS, WEIGHT_PRESETS } from "./value-score-controls";
import styles from "./benchmark.module.css";

const milliseconds = (value: number | null) => value === null ? "N/A" : Math.round(value).toLocaleString("en-US");
const unsupportedSummary = (reason: string) => reason.split(/[;:]/)[0]?.trim() || reason;
const cost = (value: number | null) => value === null ? "Unknown" : `$${value.toFixed(5)}`;
const HEADERS = [
  { label: "#" },
  { label: "Provider" },
  { label: "Runs", description: "Published attempts, including failures. Daily runs show progress toward 50 attempts per provider/country, published in cumulative batches of 10, 20, 30, 40, and 50." },
  { label: "Reliability (%)", description: "Percentage of attempts that passed country verification and completed a valid GET." },
  { label: "Latency (ms)", description: "Median complete GET time for successful attempts. Creation, connection, country verification, and release are excluded." },
  { label: "First byte (ms)", detail: true, description: "Median time to the first response byte for successful GETs." },
  { label: "Throughput (Mbps)", detail: true, description: "Median successful download throughput, in megabits per second." },
  { label: "Cost/success ($)", description: "Estimated cost of all attempts, including failures, divided by successful GETs." },
  { label: "Run cost ($)", detail: true, description: "Estimated total cost of this country's suite, including failures." },
  { label: "Value Score", description: "Weighted score from 0 to 1: GET latency (0–30,000 ms), reliability (0–100%), and cost per successful GET ($0–$0.05). Higher is better. Missing weighted metrics remain unscored. Latest runs may use different targets; scores are exploratory." },
];

export function ProxyLeaderboard({ providers, countryName, dateLabel, simulated, initialSort, dateControl }: {
  providers: ProxyGetStats[]; countryName: string; dateLabel: string; simulated: boolean; initialSort?: string; dateControl?: ReactNode;
}) {
  const cheapest = WEIGHT_PRESETS.find((preset) => preset.label === "Cheapest")?.weights ?? DEFAULT_PRESET_WEIGHTS;
  const router = useRouter();
  const [weights, setWeights] = useState(initialSort === "cost" ? cheapest : DEFAULT_PRESET_WEIGHTS);
  const [details, setDetails] = useState(false);
  const { sorted, scores, ranks } = rankProxyValues(providers, weights);
  const headers = HEADERS.filter(h => !h.detail || details);
  return <div className={styles.tableStage}>
    <BenchmarkSectionHeader controls={<WeightBar weights={weights} onChange={w => { setWeights(w); track("value_score_preset_selected", { benchmark: "proxy-performance", preset: WEIGHT_PRESETS.find(p => p.weights === w)?.label ?? "custom" }); }} />}>
      <BenchmarkTitle name={BENCHMARK_TITLES["proxy-get"]} date={dateControl} />
    </BenchmarkSectionHeader>
    <BenchmarkTablePanel label="Proxy Performance provider results">
      <div className={styles.tableScroll}>
        <table className="w-full text-left text-[0.78rem] tabular-nums" style={{ minWidth: details ? 1320 : 960 }}>
          <caption className="sr-only">{simulated ? "Simulated " : ""}Latest provider results for {countryName} as of {dateLabel}. Ranked by value score.</caption>
          <thead><tr>{headers.map(h => <th key={h.label} scope="col" data-sorted={h.label === "Value Score" ? "" : undefined} aria-sort={h.label === "Value Score" ? "descending" : undefined} className="whitespace-nowrap">
            <span className="inline-flex items-center gap-0.5">
              {h.label === "Latency (ms)" && <button type="button" aria-label={details ? "Hide GET details" : "Show GET details"} aria-expanded={details} onClick={() => { setDetails(!details); track("breakdown_toggled", { benchmark: "proxy-performance", expanded: !details }); }} className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground">
                {details ? <SquareMinus className="size-3.5" /> : <SquarePlus className="size-3.5" />}
              </button>}
              {h.label}
              {h.description && <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="inline-flex cursor-help text-muted-foreground/40 hover:text-muted-foreground" aria-label={`About ${h.label}`}><Info className="size-3" /></span></TooltipTrigger><TooltipContent side="bottom" className="max-w-[18rem] text-xs">{h.description}</TooltipContent></Tooltip>}
            </span>
          </th>)}</tr></thead>
          <tbody>{sorted.map(p => {
            const score = scores.get(p.provider);
            const rank = ranks.get(p.provider);
            const unsupported = p.status === "unsupported";
            const missingReason = unsupported
              ? p.samples[0]?.error_message ?? "Residential proxy integration is unavailable for this country."
              : !p.successes ? "No successful GETs were recorded for this country." : "No measurement is available for this metric.";
            const unavailable = <span className="text-muted-foreground" title={missingReason}>N/A</span>;
            return <tr key={p.provider} data-leader={rank === 1 ? "" : undefined} data-unsupported={unsupported ? "" : undefined} onClick={() => { const href = providerPath(p.provider); if (href) router.push(href); }}>
              <td>{rank ?? "—"}</td>
              <th scope="row"><span className="flex items-center gap-2 whitespace-nowrap">
                <Link href={providerPath(p.provider) ?? withNotteUtm(p.url, "proxy-performance")} prefetch={providerPath(p.provider) ? true : undefined} onClick={(event) => event.stopPropagation()} className="flex items-center gap-2 hover:underline">
                {PROVIDERS_BY_ID[p.provider]?.logo && <span className={`inline-flex size-6 items-center justify-center overflow-hidden rounded-[3px] ${p.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}><img src={PROVIDERS_BY_ID[p.provider].logo} decoding="sync" className="size-full object-contain" alt="" /></span>}
                <span className="leading-4">{p.displayName}</span>
                </Link>
                <RunInfoIcon meta={p.vmMeta} runDate={p.runDate} provider={p.provider} />
              </span></th>
              {unsupported ? <td colSpan={headers.length - 2} data-unsupported="">
                <Tooltip>
                  <TooltipTrigger asChild><span tabIndex={0} title={missingReason} className={styles.unsupportedReason}>{unsupportedSummary(missingReason)}</span></TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[22rem] text-xs">{missingReason}</TooltipContent>
                </Tooltip>
              </td> : <>
              <td>{proxyRunCountLabel(p)}</td>
              <td title={`${p.successes}/${p.attempts} attempts succeeded`}>{p.attempts > 0 ? `${(p.successes / p.attempts * 100).toFixed(1)}%` : unavailable}</td>
              <td>{p.medianGetMs === null ? unavailable : milliseconds(p.medianGetMs)}</td>
              {details && <><td>{p.medianFirstByteMs === null ? unavailable : milliseconds(p.medianFirstByteMs)}</td><td>{p.medianMbps?.toFixed(2) ?? unavailable}</td></>}
              <td title={p.costExplanation}>{p.successes ? cost(p.costPerSuccessUsd) : unavailable}</td>
              {details && <td title={p.costExplanation}>{cost(p.totalCostUsd)}</td>}
              <td data-sorted="" title={score == null ? !p.successes ? missingReason : "A metric required by the selected weights is missing." : "Exploratory weighted score; dates and target hosts may differ."}>{score == null ? <span className="text-muted-foreground">N/A</span> : score.toFixed(3)}</td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!providers.length && <p className="p-6 text-sm text-muted-foreground">No results for this country on the selected day.</p>}
    </BenchmarkTablePanel>
  </div>;
}
