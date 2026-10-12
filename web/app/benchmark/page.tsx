import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDownToLine, ArrowUpRight, RefreshCcw } from "lucide-react";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";

export const metadata: Metadata = {
  title: "Benchmarks",
  description: "Compare cloud browser providers on browser lifecycle speed and residential proxy performance.",
  alternates: { canonical: "https://browserarena.ai/benchmark" },
};

export default function BenchmarkPage() {
  return <BenchmarkShell benchmark="all">
    <section className="grid gap-5 sm:grid-cols-2" aria-label="Available benchmarks">
      {[
        { href: "/", title: "Browser lifecycle", Icon: RefreshCcw, description: "Compare how quickly cloud browser providers create a session, connect to it, and release it.", metrics: "Create · Connect · Release", detail: "Sequential and concurrent runs" },
        { href: "/proxy-get", title: "Proxy GET", Icon: ArrowDownToLine, description: "Compare the time and cost to download the same response through residential proxies across five countries.", metrics: "Download time · First byte · Estimated cost", detail: "5 countries · 10 attempts per provider" },
      ].map(b => <Link key={b.href} href={b.href} className="rounded-[3px] border-[1.5px] border-foreground/25 bg-card p-6 transition-colors hover:border-foreground">
        <b.Icon className="mb-6 size-8 rounded-[3px] bg-primary/20 p-1.5" aria-hidden="true" />
        <h2 className="text-xl font-semibold tracking-tight">{b.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{b.description}</p>
        <p className="mt-6 border-t border-foreground/15 pt-4 text-xs text-muted-foreground">{b.metrics}<br />{b.detail}</p>
        <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">View benchmark<ArrowUpRight className="size-4" aria-hidden="true" /></span>
      </Link>)}
    </section>
  </BenchmarkShell>;
}
