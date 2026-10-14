"use client";
import { track } from "@/lib/analytics";
import { withNotteUtm } from "@/lib/utm";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import Link from "next/link";
import {
  AGENT_ACTION_LABELS,
  AGENT_ACTION_TYPES,
  type AgentActionType,
  type BrowserThroughputProviderStats,
  type ThroughputHistory,
  type Triple,
} from "@/lib/browser-throughput-shared";
import { BrowserThroughputCharts } from "@/components/browser-throughput-charts";
import { PROVIDERS, providerPath } from "@/lib/providers";
import { sortRanked } from "@/lib/ranking";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BenchmarkSectionHeader } from "@/components/benchmarks/section-header";
import { BenchmarkTablePanel } from "@/components/benchmarks/table-panel";
import styles from "@/components/benchmarks/benchmark.module.css";

const PROVIDER_LOGOS: Record<string, string> = Object.fromEntries(
  PROVIDERS.flatMap((p) => (p.logo ? [[p.id, p.logo]] : []))
);

type View = "median" | "p95" | "p99";
type SortKey = "success" | "completion" | "aps" | "task" | AgentActionType | "drift" | "cost";
type SortDirection = "asc" | "desc";

const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  success: "desc",
  completion: "desc",
  aps: "desc",
  task: "asc",
  navigate: "asc",
  waitForSelector: "asc",
  screenshot: "asc",
  textContent: "asc",
  click: "asc",
  goBack: "asc",
  drift: "asc",
  cost: "asc",
};

function isMeasured(p: BrowserThroughputProviderStats): boolean {
  return p.actionsPerSecond.median > 0;
}

function pick(t: Triple, view: View): number {
  return t[view];
}

/** A cell for a Triple: N/A when nothing was measured, never a misleading 0. */
function TripleCell({ t, view, fmt }: { t: Triple; view: View; fmt: (v: number) => string }) {
  if (t.samples === 0) return <NotAvailable />;
  return <>{fmt(pick(t, view))}</>;
}

function fmtMs(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}`;
}

function NotAvailable() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground">N/A</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[14rem] text-xs font-sans">
        Nothing measured: no successful sample for this cell.
      </TooltipContent>
    </Tooltip>
  );
}

interface HeaderDef {
  label: string;
  sortKey?: SortKey;
  align: "left" | "center" | "right";
  tooltip?: string;
  className?: string;
}

export function BrowserThroughputTable({
  data,
  history,
  controls,
}: {
  data: BrowserThroughputProviderStats[];
  history?: ThroughputHistory;
  controls?: React.ReactNode;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("median");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: "aps", dir: "desc" });

  const headers: HeaderDef[] = [
    { label: "#", align: "center", className: "w-10" },
    { label: "Provider", align: "left" },
    { label: "Runs", align: "right", tooltip: "Measured sessions. Warm-ups are recorded but not counted. Each session runs the same action loop." },
    { label: "Success (%)", sortKey: "success", align: "right", tooltip: "Sessions where every action succeeded. One failed action fails the session." },
    { label: "Actions (%)", sortKey: "completion", align: "right", tooltip: "Actions that succeeded across all sessions, the partial completion rate." },
    { label: "Actions/s", sortKey: "aps", align: "right", tooltip: "Completed actions per second of action time, per session." },
    { label: "Task", sortKey: "task", align: "right", tooltip: "Sum of all action durations in a session, in ms (s above one second)." },
    ...AGENT_ACTION_TYPES.map((type): HeaderDef => ({
      label: AGENT_ACTION_LABELS[type],
      sortKey: type,
      align: "right",
      tooltip: ACTION_TOOLTIPS[type],
    })),
    { label: "Drift", sortKey: "drift", align: "right", tooltip: "Last loop time divided by first loop time. Above 1.0, late actions are slower than early ones. Needs runs with more than one loop." },
    { label: "$/1k actions", sortKey: "cost", align: "right", tooltip: "Cost of 1,000 actions at the median throughput, billed with the provider's granularity and minimums." },
  ];

  /** The sort value, or null when the provider has nothing to show for it. */
  function accessor(p: BrowserThroughputProviderStats, key: SortKey): number | null {
    const measured = (t: Triple) => (t.samples > 0 ? pick(t, view) : null);
    switch (key) {
      case "success":
        return p.successRate;
      case "completion":
        return p.actionCompletionRate;
      case "aps":
        return measured(p.actionsPerSecond);
      case "task":
        return measured(p.taskMs);
      case "drift":
        return p.driftRatio;
      case "cost":
        return p.costPer1kActionsUsd;
      default:
        return measured(p.perAction[key]);
    }
  }

  const sorted = useMemo(
    () =>
      sortRanked(
        data,
        isMeasured,
        (a, b) => {
          const av = accessor(a, sort.key);
          const bv = accessor(b, sort.key);
          // Missing values go last whichever way the column is sorted.
          if (av == null && bv == null) return a.displayName.localeCompare(b.displayName);
          if (av == null) return 1;
          if (bv == null) return -1;
          const diff = sort.dir === "asc" ? av - bv : bv - av;
          if (diff !== 0) return diff;
          return a.displayName.localeCompare(b.displayName);
        },
        (a, b) => a.displayName.localeCompare(b.displayName)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, sort.key, sort.dir, view]
  );

  function handleSort(key: SortKey) {
    const dir: SortDirection = sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : DEFAULT_DIRECTION[key];
    setSort({ key, dir });
    track("leaderboard_sorted", { benchmark: "browser-throughput", column: key, direction: dir });
  }

  const sortedAttr = (key: SortKey) => (sort.key === key ? "" : undefined);

  return (
    <div>
      <BenchmarkSectionHeader
        controls={
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-foreground">Percentile</span>
            <div className="flex items-center gap-1.5">
              {(["median", "p95", "p99"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => { setView(v); track("percentile_selected", { benchmark: "browser-throughput", percentile: v }); }}
                  className={`rounded-[3px] border px-3 py-1 text-[0.65rem] font-medium transition-colors ${
                    view === v
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                  }`}
                >
                  {v === "median" ? "Median" : v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {controls}
      </BenchmarkSectionHeader>

      <BenchmarkTablePanel label="Browser Throughput provider results" className={styles.tablePanelWide}>
        <Table>
          <TableHeader className="[&_tr]:border-b-[1.5px]">
            <TableRow className="border-b-[1.5px] border-foreground hover:bg-transparent">
              {headers.map((h) => {
                const sortable = Boolean(h.sortKey);
                const active = sortable && sort.key === h.sortKey;
                return (
                  <TableHead
                    key={h.label}
                    data-sorted={active ? "" : undefined}
                    className={`${h.className ?? ""} ${
                      h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left"
                    } ${sortable ? "cursor-pointer select-none hover:text-foreground" : ""} ${active ? "text-foreground" : ""}`}
                    onClick={sortable ? () => handleSort(h.sortKey!) : undefined}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {h.label}
                      {h.tooltip && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-help"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Info className="size-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[16rem] text-xs font-sans normal-case tracking-normal">
                            {h.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((p, idx) => {
              const ranked = isMeasured(p);
              const isLeader = ranked && idx === 0;
              return (
                <TableRow
                  key={p.provider}
                  data-leader={isLeader ? "" : undefined}
                  onClick={() => {
                    const href = providerPath(p.provider);
                    if (href) router.push(href);
                  }}
                >
                  <TableCell className="text-center">
                    <span className="text-[0.65rem] text-muted-foreground">{ranked ? idx + 1 : "—"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-x-2 flex-nowrap">
                      {PROVIDER_LOGOS[p.provider] && (
                        <span
                          className={`inline-flex items-center justify-center size-6 rounded-[3px] overflow-hidden shrink-0 ${
                            p.provider === "NOTTE" ? "bg-black p-[1px]" : ""
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={PROVIDER_LOGOS[p.provider]}
                            alt={`${p.displayName} logo`}
                            decoding="sync"
                            className={p.provider === "NOTTE" ? "size-full object-contain" : "size-6 object-cover"}
                          />
                        </span>
                      )}
                      <Link
                        href={providerPath(p.provider) ?? withNotteUtm(p.url, "browser-throughput")}
                        prefetch={providerPath(p.provider) ? true : undefined}
                        onClick={(event) => event.stopPropagation()}
                        className="font-semibold text-[0.82rem] text-foreground hover:text-primary whitespace-nowrap"
                      >
                        {p.displayName}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span>{p.totalRuns.toLocaleString("en-US")}</span>
                  </TableCell>
                  <TableCell data-sorted={sortedAttr("success")}>{p.successRate.toFixed(1)}%</TableCell>
                  <TableCell data-sorted={sortedAttr("completion")}>{p.actionCompletionRate.toFixed(1)}%</TableCell>
                  <TableCell data-sorted={sortedAttr("aps")}>
                    <TripleCell t={p.actionsPerSecond} view={view} fmt={(v) => v.toFixed(2)} />
                  </TableCell>
                  <TableCell data-sorted={sortedAttr("task")}>
                    <TripleCell t={p.taskMs} view={view} fmt={fmtMs} />
                  </TableCell>
                  {AGENT_ACTION_TYPES.map((type) => (
                    <TableCell key={type} data-sorted={sortedAttr(type)}>
                      <TripleCell t={p.perAction[type]} view={view} fmt={fmtMs} />
                    </TableCell>
                  ))}
                  <TableCell data-sorted={sortedAttr("drift")}>
                    {p.driftRatio != null ? `${p.driftRatio.toFixed(2)}x` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell data-sorted={sortedAttr("cost")}>
                    {p.costPer1kActionsUsd != null ? `$${p.costPer1kActionsUsd.toFixed(4)}` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </BenchmarkTablePanel>
      <p className="mt-2 text-[0.65rem] text-muted-foreground">
        Per-action columns are in milliseconds at the selected percentile, over successful actions. Row numbers
        follow the current sort and percentile; the default order is actions per second, highest first.
      </p>
      {history && <BrowserThroughputCharts providers={data} history={history} view={view} />}
    </div>
  );
}

const ACTION_TOOLTIPS: Record<AgentActionType, string> = {
  navigate: "goto(article), domcontentloaded. Full page transition.",
  waitForSelector: "waitForSelector(#firstHeading). DOM polling and CDP round trips.",
  screenshot: "Viewport PNG at 1920x1080. What a vision agent pays on every turn.",
  textContent: "textContent(#firstHeading). The cheapest action: raw CDP round-trip cost.",
  click: "Click the first visible article link in the body text and wait for the navigation it triggers.",
  goBack: "History navigation, waitUntil commit.",
};
