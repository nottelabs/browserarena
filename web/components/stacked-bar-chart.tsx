"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ProviderStats, PercentileType } from "@/lib/data-shared";

const SEGMENT_KEYS: Record<PercentileType, (keyof ProviderStats)[]> = {
  median: [
    "medianCreationMs",
    "medianConnectMs",
    "medianGotoMs",
    "medianReleaseMs",
  ],
  p90: ["p90CreationMs", "p90ConnectMs", "p90GotoMs", "p90ReleaseMs"],
  p95: ["p95CreationMs", "p95ConnectMs", "p95GotoMs", "p95ReleaseMs"],
};

const V0_SEGMENT_KEYS: Record<PercentileType, (keyof ProviderStats)[]> = {
  median: [
    "medianCreationMs",
    "medianConnectMs",
    "medianGotoMs",
    "medianScriptMs",
    "medianReleaseMs",
  ],
  p90: [
    "p90CreationMs",
    "p90ConnectMs",
    "p90GotoMs",
    "p90ScriptMs",
    "p90ReleaseMs",
  ],
  p95: [
    "p95CreationMs",
    "p95ConnectMs",
    "p95GotoMs",
    "p95ScriptMs",
    "p95ReleaseMs",
  ],
};

const CHART_CONFIG = {
  create: {
    label: "Create",
    color: "oklch(0.68 0.12 75)",
  },
  connect: {
    label: "Connect",
    color: "oklch(0.76 0.10 75)",
  },
  goto: {
    label: "Goto",
    color: "oklch(0.84 0.08 75)",
  },
  script: {
    label: "Script",
    color: "oklch(0.80 0.09 75)",
  },
  release: {
    label: "Release",
    color: "oklch(0.90 0.05 75)",
  },
} satisfies ChartConfig;

export function StackedBarChart({
  data,
  percentile = "median",
  benchmark = "hello-browser",
}: {
  data: ProviderStats[];
  percentile?: PercentileType;
  benchmark?: "hello-browser" | "v0";
}) {
  const segmentKeys =
    benchmark === "v0" ? V0_SEGMENT_KEYS[percentile] : SEGMENT_KEYS[percentile];
  const dataKeys =
    benchmark === "v0"
      ? (["create", "connect", "goto", "script", "release"] as const)
      : (["create", "connect", "goto", "release"] as const);

  const chartData = data.map((p) => {
    const entry: Record<string, string | number> = {
      provider: p.displayName,
    };
    dataKeys.forEach((key, i) => {
      entry[key] = p[segmentKeys[i]] as number;
    });
    return entry;
  });

  return (
    <ChartContainer
      config={CHART_CONFIG}
      className="aspect-auto! h-full w-full min-h-[200px]"
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        layout="vertical"
        margin={{ left: 0, right: 12 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="2 2" />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          type="category"
          dataKey="provider"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={120}
          tick={{ fontSize: 12 }}
          interval={0}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {dataKeys.map((key, i) => {
          const isLast = i === dataKeys.length - 1;
          const radius: [number, number, number, number] = isLast
            ? [0, 12, 12, 0]
            : [0, 0, 0, 0];
          return (
            <Bar
              key={key}
              dataKey={key}
              stackId="stack"
              fill={`var(--color-${key})`}
              radius={radius}
              isAnimationActive
              animationDuration={700}
              animationBegin={i * 80}
              animationEasing="ease-out"
            />
          );
        })}
      </BarChart>
    </ChartContainer>
  );
}
