import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { BenchmarkPending, BenchmarkShell } from "@/components/benchmarks/benchmark-shell";
import { ProviderDeepDive } from "@/components/provider-deep-dive";
import { BENCHMARK_CACHE_LIFE } from "@/lib/benchmark-cache";
import { PROVIDERS, providerFromSlug, providerSlug } from "@/lib/providers";
import { loadProviderPage } from "@/lib/provider-page-data";

export function generateStaticParams() {
  return PROVIDERS.map((provider) => ({ slug: providerSlug(provider) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const provider = providerFromSlug((await params).slug);
  if (!provider) return { title: "Provider" };
  return {
    title: provider.displayName,
    description: `Lifecycle, throughput, and proxy results for ${provider.displayName}.`,
  };
}

export default function ProviderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; country?: string }>;
}) {
  return <Suspense fallback={<BenchmarkPending />}>
    <ProviderContent params={params} searchParams={searchParams} />
  </Suspense>;
}

async function ProviderContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; country?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  if (!providerFromSlug(slug)) notFound();
  return <ProviderView slug={slug} date={query.date ?? ""} country={query.country ?? ""} />;
}

async function ProviderView({ slug, date, country }: { slug: string; date: string; country: string }) {
  "use cache: remote";
  cacheLife(BENCHMARK_CACHE_LIFE);
  const provider = providerFromSlug(slug);
  if (!provider) notFound();
  const data = await loadProviderPage(provider.id, { date: date || undefined, country: country || undefined });
  return <BenchmarkShell benchmark="all" inPage>
    <ProviderDeepDive provider={provider} slug={slug} lifecycle={data.lifecycle} throughput={data.throughput} proxy={data.proxy} />
  </BenchmarkShell>;
}
