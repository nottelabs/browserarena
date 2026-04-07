import {
  PROVIDER_CDP_ENDPOINT,
  vmMetaRegionLabel,
  type ProviderStats,
  type PercentileType,
  type VmMeta,
} from "@/lib/data";
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** `runDate` is YYYY-MM-DD from the results folder */
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
    <div className="grid grid-cols-[auto_1fr] text-[0.65rem] font-mono">
      {runDate && (
        <>
          <span className="px-3 py-1.5 text-muted-foreground bg-muted/30">Run date</span>
          <span className="px-3 py-1.5">{formatRunDate(runDate)}</span>
        </>
      )}
      {machineLine && (
        <>
          <span className="px-3 py-1.5 text-muted-foreground bg-muted/30">Machine</span>
          <span className="px-3 py-1.5">{machineLine}</span>
        </>
      )}
      {meta?.started_at && (
        <>
          <span className="px-3 py-1.5 text-muted-foreground bg-muted/30">Started</span>
          <span className="px-3 py-1.5">{formatDate(meta.started_at)}</span>
        </>
      )}
      {durationLabel != null && (
        <>
          <span className="px-3 py-1.5 text-muted-foreground bg-muted/30">Duration <br />(including waits)</span>
          <span className="px-3 py-1.5 align-middle items-center">{durationLabel}</span>
        </>
      )}
      {cdpInfo && (
        <>
          <span className="px-3 py-1.5 text-muted-foreground bg-muted/30">CDP RTT</span>
          <span className="px-3 py-1.5">
            {cdpInfo.rttMs}ms{cdpInfo.proxied ? " (proxied)" : ""}
          </span>
          <span className="px-3 py-1.5 text-muted-foreground bg-muted/30">CDP host</span>
          <span className="px-3 py-1.5">{cdpInfo.cdpHost}</span>
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
          <svg viewBox="0 0 16 16" fill="currentColor" className="size-3 inline-block">
            <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v7h10V3H3zm-1 9.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z" />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="p-0 overflow-hidden">
        <VmMetaTooltipBody meta={meta} runDate={runDate} provider={provider} />
      </TooltipContent>
    </Tooltip>
  );
}

export function LeaderboardTable({
  data,
  percentile = "median",
  hideTitle = false,
}: {
  data: ProviderStats[];
  percentile?: PercentileType;
  hideTitle?: boolean;
}) {
  const headers = [
    "#",
    "Provider",
    "Ran from",
    "Create",
    "Connect",
    "Goto",
    "Release",
    "Total",
    "Cost/hr",
  ];
  const segmentKeys = SEGMENT_KEYS[percentile];
  const totalKey = TOTAL_KEYS[percentile];

  return (
    <div>
      {!hideTitle && (
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-4">
          Leaderboard
        </h2>
      )}
      <Table>
        <TableHeader>
          <TableRow className="border-b-2 border-foreground hover:bg-transparent">
            {headers.map((h) => (
              <TableHead
                key={h}
                className={`text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground ${h === "Provider" || h === "Ran from" ? "text-left" : "text-right"
                  } ${h === "#" ? "w-7 text-center" : ""}`}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((p) => {
            const isWinner = p.rank === 1;
            const totalMs = p[totalKey] as number;
            return (
              <TableRow
                key={p.provider}
                className={`transition-none ${isWinner ? "bg-primary/6 hover:bg-primary/10" : ""}`}
              >
                <TableCell className="text-center py-2.5">
                  {isWinner ? (
                    <Badge className="w-5 h-5 rounded-sm p-0 text-[0.65rem] font-bold">
                      {p.rank}
                    </Badge>
                  ) : (
                    <span className="text-[0.65rem] text-muted-foreground">
                      {p.rank}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex flex-col gap-1 items-start">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[0.82rem] text-foreground hover:text-primary"
                      >
                        {p.displayName}
                      </a>
                      <span className="font-mono text-[0.6rem] text-muted-foreground">
                        {p.successRate.toFixed(1)}%
                      </span>
                      {p.failureInsights ? (
                        <ProviderFailuresPopover
                          displayName={p.displayName}
                          insights={p.failureInsights}
                          successRate={p.successRate}
                        />
                      ) : null}
                      {p.vmMeta && (
                        <MachineIcon meta={p.vmMeta} runDate={p.runDate} provider={p.provider} />
                      )}
                    </div>
                    {p.runDate ? (
                      <p className="text-[0.58rem] text-muted-foreground/85 font-mono leading-snug">
                        {formatRunDate(p.runDate)}
                      </p>
                    ) : null}
                    {p.disclaimer ? (
                      <p className="text-[0.58rem] text-muted-foreground/85 leading-snug max-w-[18rem]">
                        {p.disclaimer}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="py-2.5 text-left text-[0.65rem] text-muted-foreground font-mono">
                  {vmMetaRegionLabel(p.vmMeta) ?? "—"}
                </TableCell>
                {segmentKeys.map((key, i) => (
                  <TableCell
                    key={i}
                    className="py-2.5 text-right font-mono text-[0.72rem] text-muted-foreground tabular-nums"
                  >
                    {Math.round((p[key] as number)).toLocaleString()}
                  </TableCell>
                ))}
                <TableCell
                  className={`py-2.5 text-right font-mono text-[0.82rem] font-bold tabular-nums ${isWinner ? "text-primary" : "text-foreground"}`}
                >
                  {Math.round(totalMs).toLocaleString()}
                </TableCell>
                <TableCell className="py-2.5 text-right font-mono tabular-nums">
                  {p.pricePerHour != null ? (
                    <div className="flex flex-col items-end gap-0">
                      <span className="text-[0.72rem] text-muted-foreground">
                        ${p.pricePerHour.toFixed(2)}/hr
                      </span>
                      {p.perSessionFee != null && (
                        <span className="text-[0.58rem] text-muted-foreground/50">
                          + ${p.perSessionFee.toFixed(2)}/session
                        </span>
                      )}
                    </div>
                  ) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
