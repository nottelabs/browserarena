"use client";
import { track } from "@/lib/analytics";
import { withNotteUtm } from "@/lib/utm";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  type ProviderStats,
  type PercentileType,
} from "@/lib/data-shared";
import { SquarePlus, SquareMinus } from "lucide-react";
import Link from "next/link";
import { PROVIDERS, providerPath } from "@/lib/providers";
import { hasSuccessfulRuns, sortRanked } from "@/lib/ranking";
import { computeValueScores, DEFAULT_WEIGHTS, TAIL_SHARE } from "@/lib/value-score";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProviderFailuresPopover } from "@/components/provider-failures-popover";
import { BenchmarkSectionHeader } from "./benchmarks/section-header";
import { BenchmarkTablePanel } from "./benchmarks/table-panel";
import { WeightBar, DEFAULT_PRESET_WEIGHTS, WEIGHT_PRESETS } from "./benchmarks/value-score-controls";
import { RunInfoIcon } from "./run-info-icon";

const SEGMENT_KEYS: Record<
  PercentileType,
  (keyof ProviderStats)[]
> = {
  median: [
    "medianCreationMs",
    "medianConnectMs",
    "medianGotoMs",
    "medianReleaseMs",
  ],
  p90: ["p90CreationMs", "p90ConnectMs", "p90GotoMs", "p90ReleaseMs"],
  p95: ["p95CreationMs", "p95ConnectMs", "p95GotoMs", "p95ReleaseMs"],
  p99: ["p99CreationMs", "p99ConnectMs", "p99GotoMs", "p99ReleaseMs"],
};

const TOTAL_KEYS: Record<PercentileType, keyof ProviderStats> = {
  median: "totalTimeMs",
  p90: "p90TotalMs",
  p95: "p95TotalMs",
  p99: "p99TotalMs",
};

const PROVIDER_LOGOS: Record<string, string> = Object.fromEntries(
  PROVIDERS.flatMap((p) => (p.logo ? [[p.id, p.logo]] : []))
);

type SortDirection = "asc" | "desc";
type SortKey =
  | "reliability"
  | "create"
  | "connect"
  | "goto"
  | "release"
  | "latency"
  | "cost"
  | "value";

const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  reliability: "desc",
  create: "asc",
  connect: "asc",
  goto: "asc",
  release: "asc",
  latency: "asc",
  cost: "asc",
  value: "desc",
};

// Shown in place of a metric that needs at least one successful run.
function NotAvailable() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground">N/A</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[14rem] text-xs font-sans">
        No successful runs, so there is nothing to measure or rank.
      </TooltipContent>
    </Tooltip>
  );
}

interface HeaderDef {
  label: string;
  sortKey?: SortKey;
  align: "left" | "center" | "right";
  className?: string;
  tooltip?: string;
  mobileHidden?: boolean;
}

export function LeaderboardTable({
  data,
  percentile = "median",
  hideTitle = false,
  controls,
}: {
  data: ProviderStats[];
  percentile?: PercentileType;
  hideTitle?: boolean;
  controls?: React.ReactNode;
}) {
  const router = useRouter();
  const segmentKeys = SEGMENT_KEYS[percentile];
  const totalKey = TOTAL_KEYS[percentile];

  const headers: HeaderDef[] = [
    { label: "#", align: "center", className: "w-10" },
    { label: "Provider", align: "left" },
    { label: "Region", align: "left", tooltip: "The cloud region from where the benchmark was run.", mobileHidden: true },
    { label: "Runs", align: "right", tooltip: "Total number of benchmark runs executed for this provider.", mobileHidden: true },
    { label: "Reliability (%)", sortKey: "reliability", align: "right", tooltip: "Percentage of runs that completed successfully without errors.", mobileHidden: true },
    { label: "Create", sortKey: "create", align: "right", tooltip: "Time to create a new browser session (ms).", mobileHidden: true },
    { label: "Connect", sortKey: "connect", align: "right", tooltip: "Time to connect to the browser via CDP (ms).", mobileHidden: true },
    { label: "Goto", sortKey: "goto", align: "right", tooltip: "Time to navigate to the target page (ms).", mobileHidden: true },
    { label: "Release", sortKey: "release", align: "right", tooltip: "Time to close and release the browser session (ms).", mobileHidden: true },
    { label: "Cold create", align: "right", tooltip: "Session creation time of the run's very first session, before any warm-up (ms). One sample per run-day; excluded from every other number.", mobileHidden: true },
    { label: "Latency (ms)", sortKey: "latency", align: "right", tooltip: "Total end-to-end time for one full session lifecycle: create → connect → goto → release.", mobileHidden: true },
    { label: "Cost/hr ($)", sortKey: "cost", align: "right", tooltip: "Hourly rate charged by the provider for browser usage.", mobileHidden: true },
    { label: "Value Score", sortKey: "value", align: "right", tooltip: `Weighted composite score (0–1) combining latency, reliability, and cost. The latency term blends the selected percentile with the p95 tail (${Math.round(TAIL_SHARE * 100)}%). Adjust weights above.` },
  ];

  const [showBreakdown, setShowBreakdown] = useState(false);

  const BREAKDOWN_LABELS = new Set(["Create", "Connect", "Goto", "Release", "Cold create"]);

  const visibleHeaders = headers.filter(
    (h) => !BREAKDOWN_LABELS.has(h.label) || showBreakdown
  );

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({
    key: "value",
    dir: "desc",
  });
  const [preset, setPreset] = useState("Balanced");

  // Starts on Balanced so the highlighted preset and the initial weights match.
  const [rawWeights, setRawWeights] = useState(DEFAULT_PRESET_WEIGHTS);

  const normalizedWeights = useMemo(() => {
    const total = rawWeights.latency + rawWeights.reliability + rawWeights.cost;
    if (total === 0) return DEFAULT_WEIGHTS;
    return {
      latency: rawWeights.latency / total,
      reliability: rawWeights.reliability / total,
      cost: rawWeights.cost / total,
    };
  }, [rawWeights]);

  const valueScores = useMemo(
    () => computeValueScores(data, totalKey, normalizedWeights),
    [data, totalKey, normalizedWeights]
  );

  function presetLabel(weights: { latency: number; reliability: number; cost: number }) {
    return WEIGHT_PRESETS.find((preset) => preset.weights.latency === weights.latency && preset.weights.reliability === weights.reliability && preset.weights.cost === weights.cost)?.label;
  }

  function applyPreset(weights: { latency: number; reliability: number; cost: number }) {
    const label = presetLabel(weights) ?? "custom";
    setRawWeights(weights);
    if (label === "Fastest") {
      setPreset("Fastest");
      setSort({ key: "latency", dir: "asc" });
    } else if (label === "Cheapest") {
      setPreset("Cheapest");
      setSort({ key: "cost", dir: "asc" });
    } else {
      setPreset(label);
      setSort({ key: "value", dir: "desc" });
    }
    track("value_score_preset_selected", { benchmark: "session-performance", preset: label });
  }

  function handleSort(key: SortKey) {
    setSort({ key, dir: DEFAULT_DIRECTION[key] });
    if (key === "latency") {
      setRawWeights(WEIGHT_PRESETS.find((item) => item.label === "Fastest")!.weights);
      setPreset("Fastest");
    } else if (key === "cost") {
      setRawWeights(WEIGHT_PRESETS.find((item) => item.label === "Cheapest")!.weights);
      setPreset("Cheapest");
    } else if (key === "value") {
      // Most reliable is already a value ranking. Every other column sort was
      // using a different preset, so Value Score has to restore Balanced.
      if (preset !== "Most reliable") {
        setRawWeights(DEFAULT_PRESET_WEIGHTS);
        setPreset("Balanced");
      }
    } else {
      setPreset("");
    }
    track("leaderboard_sorted", { benchmark: "session-performance", column: key, direction: DEFAULT_DIRECTION[key] });
  }

  function accessor(p: ProviderStats, key: SortKey): number {
    switch (key) {
      case "reliability":
        return p.successRate;
      case "create":
        return (p[segmentKeys[0]] as number) ?? Infinity;
      case "connect":
        return (p[segmentKeys[1]] as number) ?? Infinity;
      case "goto":
        return (p[segmentKeys[2]] as number) ?? Infinity;
      case "release":
        return (p[segmentKeys[3]] as number) ?? Infinity;
      case "latency":
        return (p[totalKey] as number) ?? Infinity;
      case "cost":
        return p.pricePerHour ?? Infinity;
      case "value":
        return valueScores.get(p.provider) ?? 0;
    }
  }

  const sorted = useMemo(() => {
    const tiebreaker = new Map(data.map((p) => [p.provider, Math.random()]));
    return sortRanked(
      data,
      hasSuccessfulRuns,
      (a, b) => {
        const av = accessor(a, sort.key);
        const bv = accessor(b, sort.key);
        const diff = sort.dir === "asc" ? av - bv : bv - av;
        if (diff !== 0) return diff;
        return (tiebreaker.get(a.provider) ?? 0) - (tiebreaker.get(b.provider) ?? 0);
      },
      (a, b) => a.displayName.localeCompare(b.displayName)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort.key, sort.dir, percentile, valueScores]);

  const ranks = useMemo(() => {
    const map = new Map<string, number>();
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      // Unranked providers sit after the ranked ones and get no position.
      if (!hasSuccessfulRuns(sorted[i])) break;
      if (i > 0 && accessor(sorted[i], sort.key) !== accessor(sorted[i - 1], sort.key)) {
        currentRank = i + 1;
      }
      map.set(sorted[i].provider, currentRank);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, sort.key, sort.dir, percentile, valueScores]);

  return (
    <div>
      {!hideTitle && (
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-4">
          Leaderboard
        </h2>
      )}
      <BenchmarkSectionHeader controls={<WeightBar weights={rawWeights} selected={preset} onChange={applyPreset} />}>
        {controls}
      </BenchmarkSectionHeader>

      <BenchmarkTablePanel label="Browser Lifecycle provider results">
      <Table style={showBreakdown ? { minWidth: 1280 } : undefined}>
        <TableHeader className="[&_tr]:border-b-[1.5px]">
          <TableRow className="border-b-[1.5px] border-foreground hover:bg-transparent">
            {visibleHeaders.map((h) => {
              const isSortedCol = h.sortKey != null && sort.key === h.sortKey;
              return (
              <TableHead
                key={h.label}
                data-sorted={isSortedCol ? "" : undefined}
                className={`text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground ${
                  h.align === "left" ? "text-left" : h.align === "center" ? "text-center" : "text-right"
                } ${h.className ?? ""} ${h.sortKey ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""} ${isSortedCol ? "text-foreground" : ""} ${h.mobileHidden ? "hidden sm:table-cell" : ""}`}
                onClick={h.sortKey ? () => handleSort(h.sortKey!) : undefined}
              >
                <span className="inline-flex items-center gap-0.5">
                  {h.label === "Latency (ms)" ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); track("breakdown_toggled", { benchmark: "session-performance", expanded: !showBreakdown }); setShowBreakdown((v) => !v); }}
                        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showBreakdown ? "Hide latency breakdown" : "Show latency breakdown"}
                      >
                        {showBreakdown ? <SquareMinus className="size-3.5" /> : <SquarePlus className="size-3.5" />}
                      </button>
                      {h.label}
                    </>
                  ) : (
                    h.label
                  )}
                  {h.tooltip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-help"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="size-3">
                            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5a.75.75 0 0 1 1.5 0v.5a.75.75 0 0 1-1.5 0v-.5ZM8 6.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 6.5Z" />
                          </svg>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[14rem] text-xs">
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
            const ranked = hasSuccessfulRuns(p);
            const rank = ranks.get(p.provider) ?? (idx + 1);
            const isWinner = ranked && rank === 1;
            const totalMs = p[totalKey] as number;
            const sorted = (key: SortKey) => sort.key === key ? "" : undefined;
            return (
              <TableRow
                key={p.provider}
                data-leader={isWinner ? "" : undefined}
                className="transition-none"
                onClick={(event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest("a, button, input, select, textarea, [data-slot=popover-content]")) return;
                  const href = providerPath(p.provider);
                  if (href) router.push(href);
                }}
              >
                <TableCell className="text-center py-2">
                  <span className="text-[0.65rem] text-muted-foreground">
                    {ranked ? rank : "—"}
                  </span>
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex flex-col gap-1 items-start">
                    <div className="flex items-center gap-x-2 gap-y-0.5 flex-nowrap">
                      {PROVIDER_LOGOS[p.provider] && (
                        <span className={`inline-flex items-center justify-center size-6 rounded-[3px] overflow-hidden shrink-0 ${p.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}>
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
                        href={providerPath(p.provider) ?? withNotteUtm(p.url, "leaderboard")}
                        prefetch={providerPath(p.provider) ? true : undefined}
                        onClick={(event) => event.stopPropagation()}
                        className="font-semibold text-[0.82rem] text-foreground hover:text-primary"
                      >
                        {p.displayName}
                      </Link>
                      {p.vmMeta && (
                        <RunInfoIcon meta={p.vmMeta} runDate={p.runDate} provider={p.provider} />
                      )}
                    </div>
                    {p.disclaimer ? (
                      <p className="text-[0.58rem] text-muted-foreground/85 leading-snug max-w-[18rem]">
                        {p.disclaimer}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell py-2 font-mono text-[0.82rem] text-foreground tabular-nums">
                  {p.browserRegion ?? "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell py-2 text-right font-mono text-[0.82rem] text-foreground tabular-nums">
                  <span>{p.totalRuns.toLocaleString("en-US")}</span>
                  {p.concurrency > 1 && (
                    <span className="block text-[0.6rem] text-muted-foreground">
                      {(p.totalRuns / p.concurrency).toLocaleString("en-US")} &times; {p.concurrency}
                    </span>
                  )}
                </TableCell>
                <TableCell data-sorted={sorted("reliability")} className="hidden sm:table-cell py-0 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="font-mono text-[0.82rem] tabular-nums leading-none text-foreground">
                      {p.successRate.toFixed(1)}%
                    </span>
                    {p.failureInsights ? (
                      <ProviderFailuresPopover
                        displayName={p.displayName}
                        insights={p.failureInsights}
                        successRate={p.successRate}
                      />
                    ) : null}
                  </div>
                </TableCell>
                {showBreakdown && segmentKeys.map((key, i) => {
                  const segSortKeys: SortKey[] = ["create", "connect", "goto", "release"];
                  return (
                  <TableCell
                    key={i}
                    data-sorted={sorted(segSortKeys[i])}
                    className="hidden sm:table-cell py-2 text-right font-mono text-[0.82rem] text-foreground tabular-nums"
                  >
                    {ranked ? Math.round((p[key] as number)).toLocaleString("en-US") : <NotAvailable />}
                  </TableCell>
                  );
                })}
                {showBreakdown && (
                  <TableCell className="hidden sm:table-cell py-2 text-right font-mono text-[0.82rem] text-muted-foreground tabular-nums">
                    {p.coldStartCreationMs != null ? Math.round(p.coldStartCreationMs).toLocaleString("en-US") : "—"}
                  </TableCell>
                )}
                <TableCell
                  data-sorted={sorted("latency")}
                  className="hidden sm:table-cell py-2 text-right font-mono text-[0.82rem] tabular-nums text-foreground"
                >
                  {ranked ? Math.round(totalMs).toLocaleString("en-US") : <NotAvailable />}
                </TableCell>
                <TableCell data-sorted={sorted("cost")} className="hidden sm:table-cell py-2 text-right font-mono text-[0.82rem] tabular-nums text-foreground">
                  {p.pricePerHour != null ? (
                    <>${p.pricePerHour.toFixed(2)}/hr</>
                  ) : "—"}
                </TableCell>
                <TableCell data-sorted={sorted("value")} className="py-2 text-right font-mono text-[0.82rem] tabular-nums text-foreground">
                  {ranked ? (valueScores.get(p.provider) ?? 0).toFixed(3) : <NotAvailable />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </BenchmarkTablePanel>
    </div>
  );
}
