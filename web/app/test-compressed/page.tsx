import type { Metadata } from "next";
import { PROXY_COUNTRIES } from "@/lib/proxy-get";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { ProxyDashboard } from "@/components/benchmarks/proxy-dashboard";
import { loadTestProxyHistory } from "../test/proxy-demo";

export const metadata: Metadata = { title: "Compressed benchmark preview", robots: { index: false, follow: false } };

export default async function CompressedTestPage({ searchParams }: { searchParams: Promise<{ country?: string; date?: string; demo?: string; sort?: string }> }) {
  const params = await searchParams;
  const country = PROXY_COUNTRIES.find(c => c === params.country?.toUpperCase()) ?? "US";
  const simulated = params.demo !== "0";
  const history = await loadTestProxyHistory(country, params.date, simulated);
  return <BenchmarkShell benchmark="proxy-get" country={country} date={history.selectedDate ?? undefined} preview simulated={simulated} sort={params.sort}>
    <ProxyDashboard history={history} country={country} preview simulated={simulated} basePath="/test-compressed" sort={params.sort} />
  </BenchmarkShell>;
}
