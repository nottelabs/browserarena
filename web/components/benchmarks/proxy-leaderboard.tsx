"use client";

import { useState } from "react";
import { Info, SquareMinus, SquarePlus } from "lucide-react";
import type { ProxyGetStats } from "@/lib/proxy-get";
import { PROVIDERS_BY_ID } from "@/lib/providers";
import { rankProxyValues } from "@/lib/proxy-value-score";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BenchmarkSectionHeader } from "./section-header";
import { BenchmarkTablePanel } from "./table-panel";
import { WeightBar, WEIGHT_PRESETS } from "./value-score-controls";
import styles from "./benchmark.module.css";

const milliseconds = (value: number | null) => value === null ? "N/A" : Math.round(value).toLocaleString("en-US");
const cost = (value: number | null) => value === null ? "Unknown" : `$${value.toFixed(5)}`;
const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const HEADERS = [
  { label: "#" },
  { label: "Provider" },
  { label: "Runs", description: "Number of attempts, including failures." },
  { label: "Reliability (%)", description: "Percentage of attempts that passed country verification and completed a valid GET." },
  { label: "Latency (ms)", description: "Median complete GET time for successful attempts. Creation, connection, country verification, and release are excluded." },
  { label: "First byte (ms)", detail: true, description: "Median time to the first response byte for successful GETs." },
  { label: "Throughput (Mbps)", detail: true, description: "Median successful download throughput, in megabits per second." },
  { label: "Cost/success ($)", description: "Estimated cost of all attempts, including failures, divided by successful GETs." },
  { label: "Run cost ($)", detail: true, description: "Estimated total cost of this country's suite, including failures." },
  { label: "Value Score", description: "Weighted score from 0 to 1: GET latency (0–30,000 ms), reliability (0–100%), and cost per successful GET ($0–$0.05). Higher is better. Missing weighted metrics remain unscored. Latest runs may use different targets; scores are exploratory." },
];

export function ProxyLeaderboard({ providers, countryName, dateLabel, simulated, initialSort }: {
  providers: ProxyGetStats[]; countryName: string; dateLabel: string; simulated: boolean; initialSort?: string;
}) {
  const [weights, setWeights] = useState(WEIGHT_PRESETS[initialSort === "cost" ? 1 : 0].weights);
  const [details, setDetails] = useState(false);
  const { sorted, scores, ranks } = rankProxyValues(providers, weights);
  const headers = HEADERS.filter(h => !h.detail || details);
  const attempts = providers.reduce((a, p) => a + p.attempts, 0);
  const successes = providers.reduce((a, p) => a + p.successes, 0);
  return <div className={styles.tableStage}>
    <BenchmarkSectionHeader title="Benchmark" description={`Proxy Performance · Latest runs (dates and targets vary) · ${successes}/${attempts} successful`} controls={<WeightBar weights={weights} onChange={setWeights} methodologyHref="https://github.com/nottelabs/browserarena/blob/main/docs/proxy-get-value-score.md" />} />
    <BenchmarkTablePanel label="Proxy Performance provider results">
      <div className={styles.tableScroll}>
        <table className="w-full text-left text-[0.78rem] tabular-nums" style={{ minWidth: details ? 1320 : 960 }}>
          <caption className="sr-only">{simulated ? "Simulated " : ""}Latest provider results for {countryName} as of {dateLabel}; each row shows its recorded run date. Ranked by value score.</caption>
          <thead><tr>{headers.map(h => <th key={h.label} scope="col" aria-sort={h.label === "Value Score" ? "descending" : undefined} className="whitespace-nowrap">
            <span className="inline-flex items-center gap-0.5">
              {h.label === "Latency (ms)" && <button type="button" aria-label={details ? "Hide GET details" : "Show GET details"} aria-expanded={details} onClick={() => setDetails(!details)} className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground">
                {details ? <SquareMinus className="size-3.5" /> : <SquarePlus className="size-3.5" />}
              </button>}
              {h.label}
              {h.label === "Value Score" && <span aria-hidden="true" className="ml-0.5">▾</span>}
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
            return <tr key={p.provider} className={rank === 1 ? "bg-primary/6 hover:bg-primary/10" : undefined}>
              <td>{rank ?? "—"}</td>
              <th scope="row"><a href={p.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 whitespace-nowrap hover:underline">
                {PROVIDERS_BY_ID[p.provider]?.logo && <span className={`inline-flex size-6 items-center justify-center overflow-hidden rounded-[3px] border border-border ${p.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}><img src={PROVIDERS_BY_ID[p.provider].logo} className="size-full object-contain" alt="" /></span>}
                <span className="flex flex-col gap-0.5"><span>{p.displayName}</span><time dateTime={p.runDate} className="text-[0.6rem] leading-3 font-normal text-muted-foreground">{formatDate(p.runDate)}</time></span>
              </a></th>
              {unsupported ? <td colSpan={headers.length - 2} className="text-left!">
                <span className="inline-flex items-center gap-2 text-muted-foreground" title={missingReason}>
                  <span className="rounded-[3px] border border-foreground/20 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider">Unsupported</span>
                  <span className="truncate font-sans text-[0.7rem] max-w-[36rem]">{missingReason}</span>
                </span>
              </td> : <>
              <td>{p.attempts.toLocaleString("en-US")}</td>
              <td title={`${p.successes}/${p.attempts} attempts succeeded`}>{p.attempts > 0 ? `${(p.successes / p.attempts * 100).toFixed(1)}%` : unavailable}</td>
              <td>{p.medianGetMs === null ? unavailable : milliseconds(p.medianGetMs)}</td>
              {details && <><td>{p.medianFirstByteMs === null ? unavailable : milliseconds(p.medianFirstByteMs)}</td><td>{p.medianMbps?.toFixed(2) ?? unavailable}</td></>}
              <td title={p.costExplanation}>{p.successes ? cost(p.costPerSuccessUsd) : unavailable}</td>
              {details && <td title={p.costExplanation}>{cost(p.totalCostUsd)}</td>}
              <td title={score == null ? !p.successes ? missingReason : "A metric required by the selected weights is missing." : "Exploratory weighted score; dates and target hosts may differ."}>{score == null ? <span className="text-muted-foreground">N/A</span> : score.toFixed(3)}</td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!providers.length && <p className="p-6 text-sm text-muted-foreground">No results for this country on the selected day.</p>}
    </BenchmarkTablePanel>
  </div>;
}
