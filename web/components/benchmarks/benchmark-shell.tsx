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
import { BENCHMARK_TITLES } from "./benchmark-title";
import styles from "./benchmark.module.css";

const pageStripe = { backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 9px, var(--border) 9px, var(--border) 10px)" };

function PageNavBar({ home = "/" }: { home?: string }) {
  return <NavBar><NavBarContent>
    <NavBarBrand><Link href={home} prefetch={true}><Logo size="lg" /></Link></NavBarBrand>
    <NavBarActions>
      <ResourcesMenu />
      <GitHubLink />
    </NavBarActions>
  </NavBarContent></NavBar>;
}

const mainClassName = `${styles.container} flex-1 mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 sm:pt-5 pb-5 sm:pb-10`;
// One placeholder row per published provider keeps the table close to its final height.
const SKELETON_ROWS = { "hello-browser": 12, "proxy-get": 11, "browser-throughput": 12 };

/**
 * The static loading state, painted before the benchmark results stream in.
 * Dashboards get their real sidebar and placeholders in the final layout, so
 * the results replace the placeholders without moving the page.
 */
export function BenchmarkPending({ benchmark }: { benchmark?: "hello-browser" | "proxy-get" | "browser-throughput" }) {
  if (!benchmark) {
    return <div className="page-ambient min-h-screen" style={pageStripe}>
      <PageNavBar />
    </div>;
  }
  const title = BENCHMARK_TITLES[benchmark];
  return <div className="page-ambient min-h-screen flex flex-col" style={pageStripe}>
    <PageNavBar />
    <main className={mainClassName}>
      <div className={styles.dashboard} aria-busy="true">
        {/* The selected country or run mode is known only once the results load. */}
        <BenchmarkSidebar benchmark={benchmark} concurrencyLevels={[1]} simulated={false} publicRoutes proxyBasePath="/proxies" />
        <div data-skeleton="header" className={styles.skeletonHeader}>
          <h2 className={styles.skeletonTitle}>{title}</h2>
          <span data-skeleton-block className={styles.skeletonControl} />
          <span data-skeleton-block className={styles.skeletonControls} />
          <span className="sr-only">Loading {title} results</span>
        </div>
        <div data-skeleton="table" className={`${styles.skeletonTable} ${styles.tableStage}`} aria-hidden="true">
          <div data-skeleton-row>{[0, 1, 2, 3].map((cell) => <span key={cell} data-skeleton-block />)}</div>
          {Array.from({ length: SKELETON_ROWS[benchmark] }, (_, row) => <div key={row} data-skeleton-row>
            {[0, 1, 2, 3].map((cell) => <span key={cell} data-skeleton-block />)}
          </div>)}
        </div>
        <div className={styles.charts} aria-hidden="true">
          {[0, 1].map((chart) => <section key={chart} className="flex min-w-0 flex-col">
            <div data-skeleton="chart-header" className={styles.skeletonChartHeader}>
              <span data-skeleton-block />
              <span data-skeleton-block />
            </div>
            <div data-benchmark-panel="loading" />
          </section>)}
        </div>
      </div>
    </main>
    <FooterWordmark />
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
    <PageNavBar home={preview ? "/test?benchmark=all" : "/"} />
    <main className={mainClassName}>
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
