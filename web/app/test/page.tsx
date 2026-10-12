import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDownToLine, ArrowUpRight, RefreshCcw } from "lucide-react";
import { Logo } from "@/components/logo";
import { GitHubLink } from "@/components/benchmark-controls";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { HistoryCharts } from "@/components/history-charts";
import { loadLeaderboard, loadHistoricalLeaderboard } from "@/lib/data";
import { PROXY_COUNTRIES } from "@/lib/proxy-get";
import { TestNavigation } from "./navigation";
import { TestProxyResults } from "./proxy-results";
import styles from "@/components/benchmarks/benchmark.module.css";

export const metadata: Metadata = {
  title: "Benchmark layout preview",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: "/test" },
};

const DESCRIPTIONS = {
  "hello-browser": "Compare session creation, connection, navigation, and release speed, reliability, and cost.",
  "proxy-get": "Compare download speed, reliability, and cost through residential proxies across five countries.",
  all: "Choose a benchmark to compare cloud browser providers on speed, reliability, and cost.",
};

export default async function TestPage({ searchParams }: {
  searchParams: Promise<{ benchmark?: string; country?: string; concurrency?: string; sort?: string; date?: string; demo?: string }>;
}) {
  const params = await searchParams;
  const benchmark = params.benchmark === "proxy-get" ? "proxy-get" : params.benchmark === "all" ? "all" : "hello-browser";
  const country = PROXY_COUNTRIES.find(c => c === params.country?.toUpperCase()) ?? "US";
  const requestedConcurrency = Number(params.concurrency ?? 1);
  const initialConcurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency >= 1 ? requestedConcurrency : 1;
  const lifecycle = benchmark === "hello-browser" ? await loadLeaderboard("hello-browser", undefined, "median", "latency", initialConcurrency) : null;
  const concurrencyLevels = lifecycle?.metadata.availableConcurrencyLevels?.length ? lifecycle.metadata.availableConcurrencyLevels : [1, 10];
  const concurrency = concurrencyLevels.includes(initialConcurrency) ? initialConcurrency : concurrencyLevels[0];
  const providers = lifecycle && concurrency !== initialConcurrency ? (await loadLeaderboard("hello-browser", undefined, "median", "latency", concurrency)).providers : lifecycle?.providers ?? [];
  const history = benchmark === "hello-browser" ? await loadHistoricalLeaderboard("hello-browser", concurrency) : null;

  return <div className="page-ambient min-h-screen flex flex-col" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 9px, var(--border) 9px, var(--border) 10px)" }}>
    <NavBar>
      <NavBarContent>
        <NavBarBrand><Link href="/test?benchmark=all"><Logo size="lg" /></Link></NavBarBrand>
        <NavBarActions>
          <nav className="hidden sm:flex items-center gap-8 text-sm font-medium" aria-label="Site navigation">
            <Link href="/test?benchmark=all" className="hover:opacity-70">Benchmarks</Link>
            <a href="https://github.com/nottelabs/browserarena" className="text-muted-foreground hover:text-foreground" target="_blank" rel="noopener noreferrer">Methodology</a>
          </nav>
          <GitHubLink />
        </NavBarActions>
      </NavBarContent>
    </NavBar>
    <main className={`${styles.container} flex-1 mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 sm:pt-5 pb-5 sm:pb-10`}>
      <TestNavigation benchmark={benchmark} country={country} concurrency={concurrency} concurrencyLevels={concurrencyLevels} date={params.date} simulated={params.demo !== "0"} />
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">The Browser Arena</h1>
        <p className="mt-3 max-w-3xl text-[0.78rem] sm:text-sm leading-relaxed text-muted-foreground">{DESCRIPTIONS[benchmark]}</p>
      </header>
      {benchmark === "all" ? <section className="grid gap-5 sm:grid-cols-2" aria-label="Available benchmarks">
        {([
          { id: "hello-browser", title: "Session Performance", Icon: RefreshCcw, detail: "Sequential and concurrent runs", metrics: "Create · Connect · Navigate · Release" },
          { id: "proxy-get", title: "Proxy Performance", Icon: ArrowDownToLine, detail: "5 countries · 50 attempts per provider", metrics: "Download time · First byte · Estimated cost" },
        ] as const).map(b => <Link key={b.id} href={`/test?benchmark=${b.id}`} className="rounded-[3px] border-[1.5px] border-foreground/25 bg-card p-6 transition-colors hover:border-foreground">
          <b.Icon className="mb-6 size-8 rounded-[3px] bg-primary/20 p-1.5" aria-hidden="true" />
          <h2 className="text-xl font-semibold tracking-tight">{b.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{DESCRIPTIONS[b.id]}</p>
          <p className="mt-6 border-t border-foreground/15 pt-4 text-xs text-muted-foreground">{b.metrics}<br />{b.detail}</p>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">View benchmark<ArrowUpRight className="size-4" aria-hidden="true" /></span>
        </Link>)}
      </section> : benchmark === "proxy-get" ? <TestProxyResults country={country} sort={params.sort} date={params.date} simulated={params.demo !== "0"} /> : <>
        {providers.length ? <LeaderboardTable data={providers} percentile="median" hideTitle /> : <p className="py-12 text-center text-sm text-muted-foreground">No Session Performance results for this configuration yet.</p>}
        {history && <div className="mt-12"><HistoryCharts history={history} percentile="median" initialProvider={providers[0]?.provider} /></div>}
      </>}
    </main>
  </div>;
}
