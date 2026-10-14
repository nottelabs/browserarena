"use client";

import { Fragment } from "react";
import { HardDrive } from "lucide-react";
import { PROVIDER_CDP_ENDPOINT, type VmMeta } from "@/lib/data-shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const INSTANCE_MEMORY_GB: Record<string, number> = {
  "t3.micro": 1,
  "t3.small": 2,
  "t3.medium": 4,
};

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

function formatStartedHour(iso: string): string {
  const time = new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).replace(/[\u202f\u00a0]/g, " ");
  return `${time} UTC`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "less than a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (minutes > 0) parts.push(minutes === 1 ? "1 minute" : `${minutes} minutes`);
  return parts.join(" ");
}

function machineLabel(instanceType: string): string {
  const memoryGb = INSTANCE_MEMORY_GB[instanceType];
  return memoryGb == null ? instanceType : `${instanceType} (${memoryGb} GB)`;
}

function cloudLabel(cloud: string): string {
  return cloud.toLowerCase() === "aws" ? "AWS" : cloud.charAt(0).toUpperCase() + cloud.slice(1);
}

function RunInfoBody({
  meta,
  runDate,
  provider,
}: {
  meta?: VmMeta;
  runDate?: string;
  provider?: string;
}) {
  const durationMs = meta?.started_at && meta?.finished_at
    ? new Date(meta.finished_at).getTime() - new Date(meta.started_at).getTime()
    : null;
  const cdpInfo = provider ? PROVIDER_CDP_ENDPOINT[provider] : undefined;
  const rows: { label: string; value: string }[] = [];
  if (runDate) rows.push({ label: "Run date", value: formatRunDate(runDate) });
  if (meta?.cloud) rows.push({ label: "Cloud", value: cloudLabel(meta.cloud) });
  if (meta?.region) rows.push({ label: "Region", value: meta.region });
  if (meta?.instance_type) rows.push({ label: "Machine", value: machineLabel(meta.instance_type) });
  if (meta?.started_at) rows.push({ label: "Started", value: formatStartedHour(meta.started_at) });
  if (durationMs != null) rows.push({ label: "Duration", value: formatDuration(durationMs) });
  if (cdpInfo) {
    rows.push({ label: "CDP RTT", value: `${cdpInfo.rttMs}ms${cdpInfo.proxied ? " (proxied)" : ""}` });
    rows.push({ label: "CDP host", value: cdpInfo.cdpHost });
  }

  return (
    <div className="grid grid-cols-[auto_1fr] text-[0.6rem] font-mono text-foreground">
      {rows.map((row, index) => (
        <Fragment key={row.label}>
          <span className={`px-2 py-1 text-muted-foreground ${index < rows.length - 1 ? "border-b border-border" : ""}`}>{row.label}</span>
          <span className={`px-2 py-1 ${index < rows.length - 1 ? "border-b border-border" : ""}`}>{row.value}</span>
        </Fragment>
      ))}
    </div>
  );
}

export function RunInfoIcon({
  meta,
  runDate,
  provider,
}: {
  meta?: VmMeta;
  runDate?: string;
  provider?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex cursor-help text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          onClick={(event) => event.stopPropagation()}
        >
          <HardDrive className="size-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="p-0 overflow-hidden rounded-[3px] border-[1.5px] border-foreground bg-background shadow-none">
        <RunInfoBody meta={meta} runDate={runDate} provider={provider} />
      </TooltipContent>
    </Tooltip>
  );
}
