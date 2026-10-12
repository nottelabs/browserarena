import type { Metadata } from "next";
import { PROXY_COUNTRIES } from "@/lib/proxy-get";
import { loadProxyGetHistory } from "@/lib/proxy-get-history";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { ProxyDashboard } from "@/components/benchmarks/proxy-dashboard";

export const metadata: Metadata = {
  title: "Proxy Performance",
  description: "Compare full-response GET latency, reliability, and estimated cost through residential proxies in five countries.",
  alternates: { canonical: "https://browserarena.ai/proxy-get" },
};

export default async function ProxyGetPage({ searchParams }: { searchParams: Promise<{ country?: string; date?: string; sort?: string }> }) {
  const params = await searchParams;
  const country = PROXY_COUNTRIES.find(c => c === params.country?.toUpperCase()) ?? "US";
  const history = await loadProxyGetHistory(country, params.date);
  return <BenchmarkShell benchmark="proxy-get" country={country} date={history.selectedDate ?? undefined} sort={params.sort}>
    <ProxyDashboard history={history} country={country} sort={params.sort} />
  </BenchmarkShell>;
}
