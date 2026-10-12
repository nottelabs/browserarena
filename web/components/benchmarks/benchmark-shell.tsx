import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { GitHubLink } from "@/components/benchmark-controls";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import type { PROXY_COUNTRIES } from "../../../src/benchmarks/proxy-get/schema";
import { BenchmarkNavigationProvider } from "./benchmark-navigation";
import { BenchmarkSidebar } from "./sidebar";
import styles from "./benchmark.module.css";

const DESCRIPTIONS = {
  "hello-browser": "Compare session creation, connection, navigation, and release speed, reliability, and cost.",
  "proxy-get": "Compare download speed, reliability, and cost through residential proxies across five countries.",
  "browser-throughput": "Compare per-action speed inside a running session: navigate, wait, screenshot, read, click, back. Actions per second, tail latency, drift, and cost per 1,000 actions.",
  all: "Choose a benchmark to compare cloud browser providers on speed, reliability, and cost.",
};

export function BenchmarkShell({ children, benchmark, country = "US", date, concurrency = 1, concurrencyLevels = [1], lifecycleQuery, sort, preview = false, simulated = false }: {
  children: ReactNode;
  benchmark: keyof typeof DESCRIPTIONS;
  country?: (typeof PROXY_COUNTRIES)[number];
  date?: string;
  concurrency?: number;
  concurrencyLevels?: number[];
  lifecycleQuery?: string;
  sort?: string;
  preview?: boolean;
  simulated?: boolean;
}) {
  const indexHref = preview ? "/test?benchmark=all" : "/benchmark";
  return <div className="page-ambient min-h-screen flex flex-col" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 9px, var(--border) 9px, var(--border) 10px)" }}>
    <NavBar><NavBarContent>
      <NavBarBrand><Link href={preview ? indexHref : "/"}><Logo size="lg" /></Link></NavBarBrand>
      <NavBarActions>
        <nav className="hidden sm:flex items-center gap-8 text-sm font-medium" aria-label="Site navigation">
          <Link href={indexHref} className="text-muted-foreground hover:text-foreground">Benchmarks</Link>
          <a href="https://github.com/nottelabs/browserarena" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">Methodology</a>
        </nav>
        <GitHubLink />
      </NavBarActions>
    </NavBarContent></NavBar>
    <main className={`${styles.container} flex-1 mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 sm:pt-5 pb-5 sm:pb-10`}>
      <BenchmarkNavigationProvider className={styles.dashboard}>
        <BenchmarkSidebar benchmark={benchmark} country={country} date={date} simulated={simulated} concurrency={concurrency} concurrencyLevels={concurrencyLevels} publicRoutes={!preview} proxyBasePath={preview ? "/test-compressed" : "/proxy-get"} lifecycleQuery={lifecycleQuery} sort={sort} />
        <header className={`${styles.heading} mb-8`}>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">The Browser Arena</h1>
          <p className="mt-3 max-w-3xl text-[0.78rem] sm:text-sm leading-relaxed text-muted-foreground">{DESCRIPTIONS[benchmark]}</p>
        </header>
        {children}
      </BenchmarkNavigationProvider>
    </main>
  </div>;
}
