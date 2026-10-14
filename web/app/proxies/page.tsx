import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { PROXY_COUNTRIES } from "@/lib/proxy-get";
import { loadProxyGetHistory } from "@/lib/proxy-get-history";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { ProxyDashboard } from "@/components/benchmarks/proxy-dashboard";

export const metadata: Metadata = {
  title: "Proxy Performance",
  description: "Compare full-response GET latency, reliability, and estimated cost through residential proxies in five countries.",
  alternates: { canonical: "https://browserarena.ai/proxies" },
};

export default function ProxyGetPage({ searchParams }: { searchParams: Promise<{ country?: string; date?: string; sort?: string }> }) {
  return <Suspense fallback={<BenchmarkPending />}>
    <ProxyContent searchParams={searchParams} />
  </Suspense>;
}

async function ProxyContent({ searchParams }: { searchParams: Promise<{ country?: string; date?: string; sort?: string }> }) {
  const params = await searchParams;
  const country = PROXY_COUNTRIES.find(c => c === params.country?.toUpperCase()) ?? "US";
  return <ProxyView country={country} date={params.date ?? ""} sort={params.sort ?? ""} />;
}

async function ProxyView({ country, date, sort }: { country: (typeof PROXY_COUNTRIES)[number]; date: string; sort: string }) {
  "use cache: remote";
  cacheLife(BENCHMARK_CACHE_LIFE);
  const history = await loadProxyGetHistory(country, date || undefined);
  return <BenchmarkShell benchmark="proxy-get" country={country} date={history.selectedDate ?? undefined} sort={sort || undefined}>
    <ProxyDashboard history={history} country={country} sort={sort || undefined} />
  </BenchmarkShell>;
}
