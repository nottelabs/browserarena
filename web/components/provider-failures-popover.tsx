"use client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ProviderFailureInsights } from "@/lib/data-shared";
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
  const [openPattern, setOpenPattern] = useState<number | null>(null);

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-[3px] border-[1.5px] border-foreground/30 bg-background px-1.5 py-0.5 font-mono text-[0.6rem] text-foreground tabular-nums",
          "outline-none transition-colors hover:border-foreground/60 focus-visible:ring-2 focus-visible:ring-foreground/30",
          className
        )}
        aria-label={`${displayName}: ${failureCount} failed runs, ${successRate.toFixed(1)}% success. Open failure details.`}
      >
        <AlertTriangle className="size-2.5 shrink-0 text-muted-foreground" aria-hidden />
        {failureCount} failed
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-[3px] border-[1.5px] border-foreground bg-background p-0 shadow-none"
        align="start"
        side="bottom"
        sideOffset={6}
      >
        <div className="border-b border-foreground/20 px-3 py-2">
          <p className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Failures
          </p>
          <p className="mt-0.5 text-[0.78rem] font-medium text-foreground">
            {displayName}{" "}
            <span className="font-mono text-muted-foreground">
              · {successRate.toFixed(1)}% success
            </span>
          </p>
        </div>

        <div className="max-h-[min(50vh,18rem)] overflow-y-auto px-3 py-2">
          {byStage.length > 0 ? (
            <div className="mb-3">
              <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
                By stage
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {byStage.map(({ stage, count }) => (
                  <li key={stage}>
                    <span className="inline-flex items-center rounded-[3px] border border-foreground/20 bg-background px-1.5 py-0.5 font-mono text-[0.6rem] text-foreground tabular-nums">
                      {stageLabel(stage)}
                      <span className="ml-1 text-muted-foreground">×{count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Error patterns
          </p>
          <ul className="space-y-2">
            {patterns.map((p, i) => {
              const expanded = openPattern === i;
              const longBody = p.fullMessage !== p.messagePreview;
              return (
                <li
                  key={`${p.stage}-${i}-${p.messagePreview.slice(0, 40)}`}
                  className="rounded-[3px] border border-foreground/20 px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center justify-center rounded-[3px] border border-foreground/30 bg-foreground px-1.5 py-0.5 font-mono text-[0.6rem] text-background tabular-nums">
                      {p.count}×
                    </span>
                    {p.stage ? (
                      <span className="text-[0.58rem] text-muted-foreground">
                        {stageLabel(p.stage)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[0.6rem] leading-snug text-foreground/90">
                    {expanded || !longBody
                      ? p.fullMessage
                      : `${p.messagePreview}`}
                  </p>
                  {longBody ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenPattern(expanded ? null : i)
                      }
                      className="mt-1 text-[0.6rem] font-medium text-foreground underline hover:no-underline"
                    >
                      {expanded ? "Show less" : "Show full"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
