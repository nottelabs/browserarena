"use client";

export const WEIGHT_PRESETS: { label: string; weights: { latency: number; reliability: number; cost: number } }[] = [
  { label: "Fastest", weights: { latency: 100, reliability: 0, cost: 0 } },
  { label: "Cheapest", weights: { latency: 0, reliability: 0, cost: 100 } },
  { label: "Most reliable", weights: { latency: 5, reliability: 90, cost: 5 } },
  { label: "Balanced", weights: { latency: 33, reliability: 33, cost: 33 } },
];

export const DEFAULT_PRESET_WEIGHTS =
  WEIGHT_PRESETS.find((preset) => preset.label === "Balanced")?.weights ??
  WEIGHT_PRESETS[0].weights;

export function WeightBar({
  weights,
  onChange,
  selected,
}: {
  weights: { latency: number; reliability: number; cost: number };
  onChange: (w: { latency: number; reliability: number; cost: number }) => void;
  selected?: string;
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
      <select aria-label="Value score preset" className="sm:hidden! rounded-[3px] border border-foreground/25 bg-background" style={{ height: 24 }} value={Math.max(0, WEIGHT_PRESETS.findIndex(p => selected !== undefined ? p.label === selected : p.weights.latency === weights.latency && p.weights.reliability === weights.reliability && p.weights.cost === weights.cost))} onChange={e => onChange(WEIGHT_PRESETS[Number(e.target.value)].weights)}>
        {WEIGHT_PRESETS.map((preset, index) => <option key={preset.label} value={index}>{preset.label}</option>)}
      </select>
      <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
        {WEIGHT_PRESETS.map((preset) => {
          const isActive = selected !== undefined
            ? selected === preset.label
            : weights.latency === preset.weights.latency &&
              weights.reliability === preset.weights.reliability &&
              weights.cost === preset.weights.cost;
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={isActive}
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

