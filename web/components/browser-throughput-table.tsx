"use client";

import { useMemo, useState } from "react";
import {
  AGENT_ACTION_LABELS,
  AGENT_ACTION_TYPES,
  type AgentActionType,
  type BrowserThroughputProviderStats,
  type Triple,
} from "@/lib/browser-throughput-shared";
import { PROVIDERS } from "@/lib/providers";
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

function SortArrow({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <svg viewBox="0 0 8 10" fill="currentColor" className="inline-block size-2 ml-0.5 shrink-0 text-foreground">
      <path d="M4 9.5L0.5 5H7.5L4 9.5Z" />
    </svg>
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
  controls,
}: {
  data: BrowserThroughputProviderStats[];
  controls?: React.ReactNode;
}) {
  const [view, setView] = useState<View>("median");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: "aps", dir: "desc" });

  const headers: HeaderDef[] = [
    { label: "#", align: "center", className: "w-10" },
    { label: "Provider", align: "left" },
    { label: "Runs", align: "right", tooltip: "Measured sessions. Warm-ups are recorded but not counted." },
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
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: DEFAULT_DIRECTION[key] }
    );
  }

  const sc = (key: SortKey) => (sort.key === key ? "text-foreground font-medium" : "");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        {controls ?? <div />}
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-foreground">Percentile</span>
          <div className="flex items-center gap-1.5">
            {(["median", "p95", "p99"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
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
      </div>

      <div className="overflow-x-auto rounded-[3px] border-[1.5px] border-border bg-background">
        <Table>
          <TableHeader className="[&_tr]:border-b-[1.5px]">
            <TableRow className="hover:bg-transparent">
              {headers.map((h) => {
                const sortable = Boolean(h.sortKey);
                const active = sortable && sort.key === h.sortKey;
                return (
                  <TableHead
                    key={h.label}
                    className={`${h.className ?? ""} text-[0.62rem] font-semibold uppercase tracking-wider whitespace-nowrap ${
                      h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left"
                    } ${sortable ? "cursor-pointer select-none hover:text-foreground" : ""} ${active ? "text-foreground" : ""}`}
                    onClick={sortable ? () => handleSort(h.sortKey!) : undefined}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {h.tooltip ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">{h.label}</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[16rem] text-xs font-sans normal-case tracking-normal">
                            {h.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        h.label
                      )}
                      <SortArrow active={active} />
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((p, idx) => {
              const ranked = isMeasured(p);
              const isWinner = ranked && idx === 0 && sort.key === "aps" && sort.dir === "desc";
              const num = "py-2 text-right font-mono text-[0.82rem] tabular-nums";
              return (
                <TableRow
                  key={p.provider}
                  className={`transition-none h-10 sm:h-12 ${isWinner ? "bg-primary/6 hover:bg-primary/10" : ""}`}
                >
                  <TableCell className="text-center py-2">
                    <span className="text-[0.65rem] text-muted-foreground">{ranked ? idx + 1 : "—"}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-x-2 flex-nowrap">
                      {PROVIDER_LOGOS[p.provider] && (
                        <span
                          className={`inline-flex items-center justify-center size-6 rounded-[3px] overflow-hidden border border-border shrink-0 ${
                            p.provider === "NOTTE" ? "bg-black p-[1px]" : ""
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={PROVIDER_LOGOS[p.provider]}
                            alt={`${p.displayName} logo`}
                            className={p.provider === "NOTTE" ? "size-full object-contain" : "size-6 object-cover"}
                          />
                        </span>
                      )}
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[0.82rem] text-foreground hover:text-primary whitespace-nowrap"
                      >
                        {p.displayName}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className={num}>
                    <span>{p.totalRuns.toLocaleString("en-US")}</span>
                    <span className="block text-[0.6rem] text-muted-foreground">
                      {p.actionsPerSession} actions{p.concurrency > 1 ? ` · c=${p.concurrency}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className={`${num} ${sc("success")}`}>{p.successRate.toFixed(1)}%</TableCell>
                  <TableCell className={`${num} ${sc("completion")}`}>{p.actionCompletionRate.toFixed(1)}%</TableCell>
                  <TableCell className={`${num} ${sc("aps")}`}>
                    <TripleCell t={p.actionsPerSecond} view={view} fmt={(v) => v.toFixed(2)} />
                  </TableCell>
                  <TableCell className={`${num} ${sc("task")}`}>
                    <TripleCell t={p.taskMs} view={view} fmt={fmtMs} />
                  </TableCell>
                  {AGENT_ACTION_TYPES.map((type) => (
                    <TableCell key={type} className={`${num} ${sc(type)}`}>
                      <TripleCell t={p.perAction[type]} view={view} fmt={fmtMs} />
                    </TableCell>
                  ))}
                  <TableCell className={`${num} ${sc("drift")}`}>
                    {p.driftRatio != null ? `${p.driftRatio.toFixed(2)}x` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className={`${num} ${sc("cost")}`}>
                    {p.costPer1kActionsUsd != null ? `$${p.costPer1kActionsUsd.toFixed(4)}` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-[0.65rem] text-muted-foreground">
        Per-action columns are in milliseconds at the selected percentile, over successful actions. Row numbers
        follow the current sort and percentile; the default order is actions per second, highest first.
      </p>
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
