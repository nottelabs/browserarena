"use client";
import { AlertTriangle } from "lucide-react";
import type { ProviderFailureInsights } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<string, string> = {
  init: "Init",
  session_create: "Session create",
  connect_over_cdp: "Connect (CDP)",
  page_goto: "Navigation",
  session_release: "Release",
  unknown: "Unknown",
};

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage.replace(/_/g, " ");
}

export function ProviderFailuresPopover({
  displayName,
  insights,
  successRate,
  className,
}: {
  displayName: string;
  insights: ProviderFailureInsights;
  successRate: number;
  className?: string;
}) {
  const { failureCount, byStage, patterns } = insights;

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.6rem] text-amber-100/95 tabular-nums",
          "outline-none transition-colors hover:bg-amber-500/18 focus-visible:ring-2 focus-visible:ring-amber-500/50",
          className
        )}
        aria-label={`${displayName}: ${failureCount} failed runs, ${successRate.toFixed(1)}% success. Open failure details.`}
      >
        <AlertTriangle className="size-2.5 shrink-0 opacity-90" aria-hidden />
        {failureCount} failed
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(22rem,calc(100vw-1.5rem))] border-amber-500/20 bg-zinc-950 p-0 shadow-xl"
        align="start"
        side="bottom"
      >
        <div className="border-b border-border/60 px-3 py-2.5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Failures
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            {displayName}{" "}
            <span className="font-mono text-muted-foreground">
              · {successRate.toFixed(1)}% success
            </span>
          </p>
        </div>

        <div className="max-h-[min(50vh,18rem)] overflow-y-auto px-3 py-2">
          {byStage.length > 0 ? (
            <div className="mb-3">
              <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
                By stage
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {byStage.map(({ stage, count }) => (
                  <li key={stage}>
                    <Badge
                      variant="secondary"
                      className="font-mono text-[0.6rem] font-normal tabular-nums"
                    >
                      {stageLabel(stage)}
                      <span className="ml-1 text-muted-foreground">×{count}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Error patterns
          </p>
          <ul className="space-y-2">
            {patterns.map((p, i) => {
              return (
                <li
                  key={`${p.stage}-${i}-${p.errorCode}-${p.errorSummary.slice(0, 40)}`}
                  className="rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className="h-5 min-w-6 justify-center px-1 font-mono text-[0.6rem] tabular-nums">
                      {p.count}×
                    </Badge>
                    {p.stage ? (
                      <span className="text-[0.58rem] text-muted-foreground">
                        {stageLabel(p.stage)}
                      </span>
                    ) : null}
                    <Badge
                      variant="secondary"
                      className="font-mono text-[0.55rem] font-normal tracking-wide"
                    >
                      {p.errorCode}
                    </Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[0.65rem] leading-snug text-foreground/90">
                    {p.errorSummary}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
