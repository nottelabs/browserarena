"use client";

import { useState, useMemo } from "react";
import {
  PROVIDER_CDP_ENDPOINT,
  vmMetaRegionLabel,
  type ProviderStats,
  type PercentileType,
  type VmMeta,
} from "@/lib/data-shared";
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
import { HardDrive, SquarePlus, SquareMinus, SquareArrowOutUpRight } from "lucide-react";

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
};

const TOTAL_KEYS: Record<PercentileType, keyof ProviderStats> = {
  median: "totalTimeMs",
  p90: "p90TotalMs",
  p95: "p95TotalMs",
};

const PROVIDER_LOGOS: Record<string, string> = {
  NOTTE: "/logos/notte.jpg",
  ANCHORBROWSER: "/logos/anchorbrowser.png",
  BROWSERBASE: "/logos/browserbase.png",
  HYPERBROWSER: "/logos/hyperbrowser.png",
  KERNEL: "/logos/kernel.png",
  STEEL: "/logos/steel.png",
  BROWSER_USE: "/logos/browseruse.png",
};

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

interface ValueWeights {
  latency: number;
  reliability: number;
  cost: number;
}

const VALUE_ANCHORS = {
  latency:     { floor: 10_000, ceiling: 0 },
  reliability: { floor: 90,     ceiling: 100 },
  cost:        { floor: 0.20,   ceiling: 0 },
};

const DEFAULT_WEIGHTS: ValueWeights = { latency: 1 / 3, reliability: 1 / 3, cost: 1 / 3 };

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function computeValueScores(
  providers: ProviderStats[],
  totalKey: keyof ProviderStats,
  weights: ValueWeights
): Map<string, number> {
  const scores = new Map<string, number>();
  if (providers.length === 0) return scores;

  const total = weights.latency + weights.reliability + weights.cost;
  const wLat = total > 0 ? weights.latency / total : 1 / 3;
  const wRel = total > 0 ? weights.reliability / total : 1 / 3;
  const wCost = total > 0 ? weights.cost / total : 1 / 3;

  const { latency: latA, reliability: relA, cost: costA } = VALUE_ANCHORS;
  const latRange = latA.floor - latA.ceiling;
  const relRange = relA.ceiling - relA.floor;
  const costRange = costA.floor - costA.ceiling;

  for (const p of providers) {
    const lat = (p[totalKey] as number) ?? latA.floor;
    const rel = p.successRate;
    const cost = p.pricePerHour;

    const normLat = latRange > 0 ? clamp01((latA.floor - lat) / latRange) : 1;
    const normRel = relRange > 0 ? clamp01((rel - relA.floor) / relRange) : 1;
    const normCost = cost != null && costRange > 0
      ? clamp01((costA.floor - cost) / costRange)
      : 0;

    scores.set(p.provider, wLat * normLat + wRel * normRel + wCost * normCost);
  }

  return scores;
}

const WEIGHT_PRESETS: { label: string; weights: { latency: number; reliability: number; cost: number } }[] = [
  { label: "Reliable first", weights: { latency: 20, reliability: 60, cost: 20 } },
  { label: "Speed first", weights: { latency: 60, reliability: 20, cost: 20 } },
  { label: "Budget first", weights: { latency: 20, reliability: 20, cost: 60 } },
  { label: "Balanced", weights: { latency: 33, reliability: 33, cost: 33 } },
];

function WeightBar({
  weights,
  onChange,
}: {
  weights: { latency: number; reliability: number; cost: number };
  onChange: (w: { latency: number; reliability: number; cost: number }) => void;
}) {
  const total = weights.latency + weights.reliability + weights.cost || 1;
  const pcts = {
    latency: Math.round((weights.latency / total) * 100),
    reliability: Math.round((weights.reliability / total) * 100),
    cost: Math.round((weights.cost / total) * 100),
  };

  const segments: { key: keyof typeof weights; label: string; color: string }[] = [
    { key: "reliability", label: "Reliability", color: "bg-emerald-500/80" },
    { key: "latency", label: "Latency", color: "bg-blue-500/80" },
    { key: "cost", label: "Cost", color: "bg-amber-500/80" },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <a
        href="https://github.com/nottelabs/browserarena"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-widest text-foreground hover:text-primary transition-colors"
      >
        Value Score
        <SquareArrowOutUpRight className="size-2.5" />
      </a>
      <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
        {WEIGHT_PRESETS.map((preset) => {
          const isActive =
            weights.latency === preset.weights.latency &&
            weights.reliability === preset.weights.reliability &&
            weights.cost === preset.weights.cost;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.weights)}
              className={`rounded-[3px] border px-3 py-1 text-[0.65rem] font-medium transition-colors ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex h-2 w-full sm:flex-1 max-w-48 overflow-hidden rounded-full bg-muted">
          {segments.map(({ key, color }, i) => (
            <div
              key={key}
              className={`${color} transition-all duration-200 ${i === 0 ? "rounded-l-full" : ""} ${i === segments.length - 1 ? "rounded-r-full" : ""}`}
              style={{ width: `${pcts[key]}%` }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {segments.map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-1">
              <span className={`size-1.5 rounded-full ${color}`} />
              <span className="text-[0.55rem] text-muted-foreground">
                {label}
              </span>
              <span className="font-mono text-[0.6rem] tabular-nums text-muted-foreground">
                {pcts[key]}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SortArrow({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <svg
      viewBox="0 0 8 10"
      fill="currentColor"
      className="inline-block size-2 ml-0.5 shrink-0 text-foreground"
    >
      <path d="M4 9.5L0.5 5H7.5L4 9.5Z" />
    </svg>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

function formatRunDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function VmMetaTooltipBody({
  meta,
  runDate,
  provider,
}: {
  meta?: VmMeta;
  runDate?: string;
  provider?: string;
}) {
  const regionFromMeta = vmMetaRegionLabel(meta);
  const machineLine =
    meta?.instance_type && regionFromMeta
      ? `${meta.instance_type} · ${regionFromMeta}`
      : meta?.instance_type
        ? meta.instance_type
        : regionFromMeta
          ? regionFromMeta
          : null;
  const durationMs = meta?.started_at && meta?.finished_at
    ? new Date(meta.finished_at).getTime() - new Date(meta.started_at).getTime()
    : null;
  const durationLabel = durationMs != null
    ? durationMs >= 3_600_000
      ? `${Math.floor(durationMs / 3_600_000)}h ${Math.round((durationMs % 3_600_000) / 60_000)}m`
      : `${Math.round(durationMs / 60_000)}m`
    : null;
  const cdpInfo = provider ? PROVIDER_CDP_ENDPOINT[provider] : undefined;

  return (
    <div className="grid grid-cols-[auto_1fr] text-[0.6rem] font-mono text-foreground">
      {runDate && (
        <>
          <span className="px-2 py-1 text-muted-foreground border-b border-border">Run date</span>
          <span className="px-2 py-1 border-b border-border">{formatRunDate(runDate)}</span>
        </>
      )}
      {machineLine && (
        <>
          <span className="px-2 py-1 text-muted-foreground border-b border-border">Machine</span>
          <span className="px-2 py-1 border-b border-border">{machineLine}</span>
        </>
      )}
      {meta?.started_at && (
        <>
          <span className="px-2 py-1 text-muted-foreground border-b border-border">Started</span>
          <span className="px-2 py-1 border-b border-border">{formatDate(meta.started_at)}</span>
        </>
      )}
      {durationLabel != null && (
        <>
          <span className="px-2 py-1 text-muted-foreground border-b border-border">Duration</span>
          <span className="px-2 py-1 border-b border-border">{durationLabel}</span>
        </>
      )}
      {cdpInfo && (
        <>
          <span className="px-2 py-1 text-muted-foreground border-b border-border">CDP RTT</span>
          <span className="px-2 py-1 border-b border-border">
            {cdpInfo.rttMs}ms{cdpInfo.proxied ? " (proxied)" : ""}
          </span>
          <span className="px-2 py-1 text-muted-foreground">CDP host</span>
          <span className="px-2 py-1">{cdpInfo.cdpHost}</span>
        </>
      )}
    </div>
  );
}

function MachineIcon({
  meta,
  runDate,
  provider,
}: {
  meta: VmMeta;
  runDate?: string;
  provider?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
          <HardDrive className="size-3 inline-block" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="p-0 overflow-hidden rounded-[3px] border-[1.5px] border-foreground bg-background shadow-none">
        <VmMetaTooltipBody meta={meta} runDate={runDate} provider={provider} />
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
    { label: "Latency (ms)", sortKey: "latency", align: "right", tooltip: "Total end-to-end time for one full session lifecycle: create → connect → goto → release.", mobileHidden: true },
    { label: "Cost/hr ($)", sortKey: "cost", align: "right", tooltip: "Hourly rate charged by the provider for browser usage.", mobileHidden: true },
    { label: "Value Score", sortKey: "value", align: "right", tooltip: "Weighted composite score (0–1) combining latency, reliability, and cost. Adjust weights above." },
  ];

  const [showBreakdown, setShowBreakdown] = useState(false);

  const BREAKDOWN_LABELS = new Set(["Create", "Connect", "Goto", "Release"]);

  const visibleHeaders = headers.filter(
    (h) => !BREAKDOWN_LABELS.has(h.label) || showBreakdown
  );

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({
    key: "value",
    dir: "desc",
  });

  const [rawWeights, setRawWeights] = useState({ latency: 33, reliability: 33, cost: 33 });

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

  function handleSort(key: SortKey) {
    setSort({ key, dir: DEFAULT_DIRECTION[key] });
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
    const arr = [...data];
    arr.sort((a, b) => {
      const av = accessor(a, sort.key);
      const bv = accessor(b, sort.key);
      const diff = sort.dir === "asc" ? av - bv : bv - av;
      if (diff !== 0) return diff;
      return (tiebreaker.get(a.provider) ?? 0) - (tiebreaker.get(b.provider) ?? 0);
    });
    return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort.key, sort.dir, percentile, valueScores]);

  const ranks = useMemo(() => {
    const map = new Map<string, number>();
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
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
      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        {controls && <div className="shrink-0">{controls}</div>}
        <div className={`flex items-center gap-3 ${controls ? "" : "ml-auto"}`}>
          <WeightBar weights={rawWeights} onChange={(w) => { setRawWeights(w); setSort({ key: "value", dir: "desc" }); }} />
        </div>
      </div>

      <div className="border-[1.5px] border-foreground rounded-[3px] overflow-hidden">
      <Table>
        <TableHeader className="[&_tr]:border-b-[1.5px]">
          <TableRow className="border-b-[1.5px] border-foreground hover:bg-transparent">
            {visibleHeaders.map((h) => {
              const isSortedCol = h.sortKey != null && sort.key === h.sortKey;
              return (
              <TableHead
                key={h.label}
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
                        onClick={(e) => { e.stopPropagation(); setShowBreakdown((v) => !v); }}
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
                  {h.sortKey && (
                    <SortArrow active={sort.key === h.sortKey} />
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
            const rank = ranks.get(p.provider) ?? (idx + 1);
            const isWinner = rank === 1;
            const totalMs = p[totalKey] as number;
            const sc = (key: SortKey) => sort.key === key ? "text-foreground font-medium" : "";
            return (
              <TableRow
                key={p.provider}
                className={`transition-none h-10 sm:h-12 ${isWinner ? "bg-primary/6 hover:bg-primary/10" : ""}`}
              >
                <TableCell className="text-center py-2.5">
                  <span className="text-[0.65rem] text-muted-foreground">
                    {rank}
                  </span>
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex flex-col gap-1 items-start">
                    <div className="flex items-center gap-x-2 gap-y-0.5 flex-nowrap">
                      {PROVIDER_LOGOS[p.provider] && (
                        <span className={`inline-flex items-center justify-center size-6 rounded-[3px] overflow-hidden border border-border shrink-0 ${p.provider === "NOTTE" ? "bg-black p-[1px]" : ""}`}>
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
                        className="font-semibold text-[0.82rem] text-foreground hover:text-primary"
                      >
                        {p.displayName}
                      </a>
                      {p.vmMeta && (
                        <MachineIcon meta={p.vmMeta} runDate={p.runDate} provider={p.provider} />
                      )}
                    </div>
                    {p.disclaimer ? (
                      <p className="text-[0.58rem] text-muted-foreground/85 leading-snug max-w-[18rem]">
                        {p.disclaimer}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell py-2.5 font-mono text-[0.82rem] text-foreground tabular-nums">
                  {p.browserRegion ?? "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell py-2.5 text-right font-mono text-[0.82rem] text-foreground tabular-nums">
                  <span>{p.totalRuns.toLocaleString("en-US")}</span>
                  {p.concurrency > 1 && (
                    <span className="block text-[0.6rem] text-muted-foreground">
                      {(p.totalRuns / p.concurrency).toLocaleString("en-US")} &times; {p.concurrency}
                    </span>
                  )}
                </TableCell>
                <TableCell className={`hidden sm:table-cell py-2.5 text-right ${sc("reliability")}`}>
                  <div className="flex flex-col items-end h-[2.25rem] justify-center">
                    <span className="font-mono text-[0.82rem] tabular-nums leading-tight text-foreground">
                      {p.successRate.toFixed(1)}%
                    </span>
                    {p.failureInsights ? (
                      <ProviderFailuresPopover
                        displayName={p.displayName}
                        insights={p.failureInsights}
                        successRate={p.successRate}
                      />
                    ) : (
                      <span className="text-[0.6rem] leading-tight invisible">placeholder</span>
                    )}
                  </div>
                </TableCell>
                {showBreakdown && segmentKeys.map((key, i) => {
                  const segSortKeys: SortKey[] = ["create", "connect", "goto", "release"];
                  return (
                  <TableCell
                    key={i}
                    className={`hidden sm:table-cell py-2.5 text-right font-mono text-[0.82rem] text-foreground tabular-nums ${sc(segSortKeys[i])}`}
                  >
                    {Math.round((p[key] as number)).toLocaleString("en-US")}
                  </TableCell>
                  );
                })}
                <TableCell
                  className={`hidden sm:table-cell py-2.5 text-right font-mono text-[0.82rem] tabular-nums text-foreground ${sc("latency")}`}
                >
                  {Math.round(totalMs).toLocaleString("en-US")}
                </TableCell>
                <TableCell className={`hidden sm:table-cell py-2.5 text-right font-mono text-[0.82rem] tabular-nums text-foreground ${sc("cost")}`}>
                  {p.pricePerHour != null ? (
                    <>${p.pricePerHour.toFixed(2)}/hr</>
                  ) : "—"}
                </TableCell>
                <TableCell className={`py-2.5 text-right font-mono text-[0.82rem] tabular-nums text-foreground ${sc("value")}`}>
                  {(valueScores.get(p.provider) ?? 0).toFixed(3)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
