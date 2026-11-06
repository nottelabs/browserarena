"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SUCCESS_WORDS, type CaptchaRow, type CaptchaTypeColumn } from "@/lib/captcha-leaderboard";
import { PROVIDERS_BY_ID, providerPath } from "@/lib/providers";
import { withNotteUtm } from "@/lib/utm";
import { BENCHMARK_TITLES, BenchmarkTitle } from "./benchmark-title";
import { BenchmarkSectionHeader } from "./section-header";
import { BenchmarkTablePanel } from "./table-panel";
import styles from "./benchmark.module.css";
import captcha from "./captcha.module.css";

// Fixed provider width so added CAPTCHA types get the space, not the provider column.
const PROVIDER_WIDTH = 200;
const TYPE_WIDTH = 190;
const seconds = (ms: number | null) => ms === null ? "" : `${(ms / 1000).toFixed(1)}s`;
const unsupportedSummary = (reason: string) => reason.split(/[;:]/)[0]?.trim() || reason;
const OVERALL = "Successful attempts across all CAPTCHA types, out of attempts run. Errors count as failures. Ranked by this rate, then by the median time of successful attempts.";
const SIGNAL_MEANING: Record<CaptchaTypeColumn["signal"], string> = {
  server_acceptance: "Success means the fixture's server accepted the token.",
  token_delivery: "Success means the page reported a delivered token; no server verifier checks it.",
  page_check: "Success means the page's own in-browser check accepted the answer; no server verifies it.",
  page_reached: "Success means the page stayed usable with no challenge shown.",
};
const typeDescription = (column: CaptchaTypeColumn) => `${column.signal_label}. ${SIGNAL_MEANING[column.signal]} Errors count as failures. Time is the median of successful attempts.`;

function HeaderInfo({ label, description }: { label: string; description: string }) {
  return <Tooltip>
    <TooltipTrigger asChild><span tabIndex={0} className="inline-flex cursor-help text-muted-foreground/40 hover:text-muted-foreground" aria-label={`About ${label}`}><Info className="size-3" /></span></TooltipTrigger>
    <TooltipContent side="bottom" className="max-w-[18rem] text-xs">{description}</TooltipContent>
  </Tooltip>;
}

export function CaptchaLeaderboard({ columns, rows, caption, dateControl, summary }: {
  columns: CaptchaTypeColumn[]; rows: CaptchaRow[]; caption: string; dateControl?: ReactNode; summary?: ReactNode;
}) {
  const router = useRouter();
  const headers = [
    { key: "rank", label: "#" },
    { key: "provider", label: "Provider" },
    { key: "overall", label: "Overall", description: OVERALL },
    ...columns.map(column => ({ key: column.id, label: column.label, description: typeDescription(column) })),
  ];
  return <div className={styles.tableStage}>
    <BenchmarkSectionHeader controls={summary}>
      <BenchmarkTitle name={BENCHMARK_TITLES.captcha} date={dateControl} />
    </BenchmarkSectionHeader>
    <BenchmarkTablePanel label="CAPTCHA Handling provider results">
      <div className={`${styles.tableScroll} ${captcha.region}`} role="region" aria-label="Provider CAPTCHA results" tabIndex={0}>
        <table className="w-full text-left text-[0.78rem] tabular-nums" style={{ minWidth: Math.max(960, PROVIDER_WIDTH + 40 + (columns.length + 1) * TYPE_WIDTH) }}>
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{headers.map(h => <th key={h.key} scope="col" style={h.key === "provider" ? { width: PROVIDER_WIDTH } : undefined} data-sorted={h.key === "overall" ? "" : undefined} aria-sort={h.key === "overall" ? "descending" : undefined} className="whitespace-nowrap">
            <span className="inline-flex items-center gap-0.5">{h.label}{h.description && <HeaderInfo label={h.label} description={h.description} />}</span>
          </th>)}</tr></thead>
          <tbody>{rows.map(row => {
            const href = providerPath(row.providerKey);
            const url = PROVIDERS_BY_ID[row.providerKey]?.url;
            return <tr key={row.provider} data-leader={row.rank === 1 ? "" : undefined} data-unsupported={row.unsupportedReason ? "" : undefined} onClick={() => { if (href) router.push(href); }}>
              <td>{row.rank ?? "–"}</td>
              <th scope="row"><span className="flex items-center gap-2 whitespace-nowrap">
                {href || url ? <Link href={href ?? withNotteUtm(url!, "captcha-handling")} prefetch={href ? true : undefined} onClick={event => event.stopPropagation()} className="flex items-center gap-2 hover:underline">
                  <ProviderName row={row} />
                </Link> : <span className="flex items-center gap-2"><ProviderName row={row} /></span>}
              </span></th>
              {row.unsupportedReason || row.note ? <td colSpan={columns.length + 1} data-unsupported="" data-note={row.note ? "" : undefined}>
                <Tooltip>
                  <TooltipTrigger asChild><span tabIndex={0} title={row.unsupportedReason ?? row.note} className={styles.unsupportedReason}>{unsupportedSummary(row.unsupportedReason ?? row.note!)}</span></TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[22rem] text-xs">{row.unsupportedReason ?? row.note}</TooltipContent>
                </Tooltip>
              </td> : <>
                <td data-sorted="" title={row.attempted ? `${row.successes} of ${row.attempted} attempts succeeded` : "No attempts were run."}>
                  <span className={captcha.score}><strong>{row.successes} / {row.attempted}</strong><span className={captcha.time}>{seconds(row.medianMs)}</span></span>
                </td>
                {row.results.map((result, index) => {
                  const column = columns[index];
                  return <td key={result.type}>
                    <span className={captcha.score}>
                      {/* Tapping a dot shows its label; it must not open the provider page. */}
                      <ol className={captcha.rounds} aria-label="Rounds" onClick={event => event.stopPropagation()}>{result.rounds.map(round =>
                        <li key={round.key} data-outcome={round.outcome} data-label={round.label} aria-label={round.label} tabIndex={0} />)}</ol>
                      <strong aria-label={`${row.name} ${column.label}: ${result.successes} of ${result.attempted} ${SUCCESS_WORDS[column.signal]}`}>{result.successes} / {result.attempted}</strong>
                      <span className={captcha.time}>{seconds(result.medianMs)}</span>
                    </span>
                    {result.notRun > 0 && <span className={captcha.stat}>{result.notRun} not run</span>}
                    {result.cleanupErrors > 0 && <span className={captcha.stat}>{result.cleanupErrors} cleanup failure{result.cleanupErrors === 1 ? "" : "s"}</span>}
                  </td>;
                })}
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </BenchmarkTablePanel>
  </div>;
}

function ProviderName({ row }: { row: CaptchaRow }) {
  return <>
    {row.logo && <span className={`inline-flex size-6 items-center justify-center overflow-hidden rounded-[3px] ${row.providerKey === "NOTTE" ? "bg-black p-[1px]" : ""}`}><img src={row.logo} decoding="sync" className="size-full object-contain" alt="" /></span>}
    <span className="leading-4">{row.name}</span>
  </>;
}

export type CaptchaRun = { id: string; label: string; rounds: number; providers: number; attempts: number; planned: number; status: string; href: string };

export function CaptchaRuns({ runs, selected }: { runs: CaptchaRun[]; selected: string }) {
  const router = useRouter();
  return <BenchmarkTablePanel label="Published CAPTCHA campaigns" className={captcha.runs}>
    <div className={`${styles.tableScroll} ${captcha.region}`} role="region" aria-label="Published CAPTCHA campaigns" tabIndex={0}>
      <table className="w-full text-left text-[0.78rem] tabular-nums" style={{ minWidth: 640 }}>
        <thead><tr>{["#", "Run", "Sessions", "Providers", "Attempts", "Status"].map(label => <th key={label} scope="col" className="whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{runs.map((run, index) => <tr key={run.id} aria-current={run.id === selected ? "page" : undefined} onClick={() => router.push(run.href)}>
          <td>{index + 1}</td>
          <th scope="row"><Link href={run.href} onClick={event => event.stopPropagation()} className="hover:underline">{run.label}</Link></th>
          <td title="Fresh sessions per provider and CAPTCHA">{run.rounds}</td>
          <td>{run.providers}</td>
          <td>{run.attempts} / {run.planned}</td>
          <td>{run.status}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </BenchmarkTablePanel>;
}
