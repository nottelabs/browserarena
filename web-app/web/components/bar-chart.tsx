import type { ProviderStats } from "@/lib/data";

export function BarChart({ data }: { data: ProviderStats[] }) {
  const maxTotal = data[data.length - 1].totalTimeMs;

  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-[0.12em] text-muted mb-3">
        Total Latency
      </div>
      {data.map((p) => (
        <div key={p.provider} className="flex items-center gap-2 mb-1.5">
          <span className="w-20 text-right text-[0.68rem] font-medium text-[#666]">
            {p.displayName}
          </span>
          <div className="flex-1 h-3.5 bg-bar-track">
            <div
              className="h-full bg-ink"
              style={{ width: `${(p.totalTimeMs / maxTotal) * 100}%` }}
            />
          </div>
          <span className="font-mono text-[0.6rem] w-11 text-muted">
            {Math.round(p.totalTimeMs)}
          </span>
        </div>
      ))}
    </div>
  );
}
