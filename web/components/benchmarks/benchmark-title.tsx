import type { ReactNode } from "react";

export const BENCHMARK_TITLES = {
  "hello-browser": "Browser Lifecycle",
  "proxy-get": "Proxy Performance",
  "browser-throughput": "Browser Throughput",
} as const;

export function BenchmarkTitle({ name, date }: { name: string; date?: ReactNode }) {
  return <div>
    <h2 data-benchmark-title="">{name}</h2>
    {date}
  </div>;
}
