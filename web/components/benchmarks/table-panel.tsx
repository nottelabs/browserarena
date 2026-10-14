import type { ReactNode } from "react";
import styles from "./benchmark.module.css";

// Reserve the same nine provider slots on both benchmarks, without inventing rows.
export function BenchmarkTablePanel({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  return <div data-benchmark-panel="table" className={`${styles.tablePanel} ${className} overflow-hidden rounded-[3px] border-[1.5px] border-foreground bg-background`} aria-label={label}>
    {children}
  </div>;
}
