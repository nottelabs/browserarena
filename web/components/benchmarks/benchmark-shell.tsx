import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { GitHubLink } from "@/components/benchmark-controls";
import { ResourcesMenu } from "@/components/resources-menu";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import { PROXY_COUNTRIES } from "../../../src/benchmarks/proxy-get/schema";
import { BenchmarkNavigationProvider, PrefetchLinks } from "./benchmark-navigation";
import { FooterWordmark } from "@/components/footer-wordmark";
import { BenchmarkSidebar } from "./sidebar";
import type { BENCHMARK_TITLES } from "./benchmark-title";
import styles from "./benchmark.module.css";

const pageStripe = { backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 9px, var(--border) 9px, var(--border) 10px)" };

export function BenchmarkPending() {
  return <div className="page-ambient min-h-screen" style={pageStripe}>
    <NavBar><NavBarContent>
      <NavBarBrand><Link href="/" prefetch={true}><Logo size="lg" /></Link></NavBarBrand>
      <NavBarActions>
        <ResourcesMenu />
        <GitHubLink />
      </NavBarActions>
    </NavBarContent></NavBar>
  </div>;
}

export function BenchmarkShell({ children, benchmark, country = "US", date, concurrency = 1, concurrencyLevels = [1], lifecycleQuery, sort, preview = false, simulated = false, inPage = false }: {
  children: ReactNode;
  benchmark: keyof typeof BENCHMARK_TITLES | "all";
  country?: (typeof PROXY_COUNTRIES)[number];
  date?: string;
  concurrency?: number;
  concurrencyLevels?: number[];
  lifecycleQuery?: string;
  sort?: string;
  preview?: boolean;
  simulated?: boolean;
  inPage?: boolean;
}) {
  const prefetchHrefs = preview ? [] : [
    "/",
    "/proxies",
    "/throughput",
    "/faq",
    ...PROXY_COUNTRIES.filter((countryCode) => countryCode !== "US").map((countryCode) => `/proxies?country=${countryCode}`),
    ...concurrencyLevels.filter((level) => level !== 1).flatMap((level) => [`/?concurrency=${level}`, `/throughput?concurrency=${level}`]),
  ];
  return <div className="page-ambient min-h-screen flex flex-col" style={pageStripe}>
    <PrefetchLinks hrefs={prefetchHrefs} />
    <NavBar><NavBarContent>
      <NavBarBrand><Link href={preview ? "/test?benchmark=all" : "/"} prefetch={true}><Logo size="lg" /></Link></NavBarBrand>
      <NavBarActions>
        <ResourcesMenu />
        <GitHubLink />
      </NavBarActions>
    </NavBarContent></NavBar>
    <main className={`${styles.container} flex-1 mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 sm:pt-5 pb-5 sm:pb-10`}>
      <BenchmarkNavigationProvider className={styles.dashboard}>
        {inPage ? <div className={styles.inPageLayout}>
          <BenchmarkSidebar benchmark={benchmark} country={country} date={date} simulated={simulated} concurrency={concurrency} concurrencyLevels={concurrencyLevels} publicRoutes={!preview} proxyBasePath={preview ? "/test-compressed" : "/proxies"} lifecycleQuery={lifecycleQuery} sort={sort} inPage />
          <div className={styles.inPageBody}>{children}</div>
        </div> : <>
          <BenchmarkSidebar benchmark={benchmark} country={country} date={date} simulated={simulated} concurrency={concurrency} concurrencyLevels={concurrencyLevels} publicRoutes={!preview} proxyBasePath={preview ? "/test-compressed" : "/proxies"} lifecycleQuery={lifecycleQuery} sort={sort} />
          {children}
        </>}
      </BenchmarkNavigationProvider>
    </main>
    <FooterWordmark />
  </div>;
}
