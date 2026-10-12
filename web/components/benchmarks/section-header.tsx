import type { ReactNode } from "react";

export function BenchmarkSectionHeader({ title, description, children, controls, chart = false }: {
  title?: string;
  description?: string;
  children?: ReactNode;
  controls?: ReactNode;
  chart?: boolean;
}) {
  return <div data-section-header={chart ? "chart" : "benchmark"} className="mb-4 flex flex-wrap items-center justify-between gap-4">
    <div>{children ?? <>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      <p className="mt-1 text-[0.72rem] text-muted-foreground">{description}</p>
    </>}</div>
    <div data-section-controls>{controls}</div>
  </div>;
}
