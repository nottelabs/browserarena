import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDownToLine, ArrowUpRight, RefreshCcw } from "lucide-react";
import { BenchmarkShell } from "@/components/benchmarks/benchmark-shell";

export const metadata: Metadata = {
  title: "Benchmarks",
  description: "Compare cloud browser providers with the Session Performance and Proxy Performance benchmarks.",
  alternates: { canonical: "https://browserarena.ai/benchmark" },
};

export default function BenchmarkPage() {
  return <BenchmarkShell benchmark="all">
    <section className="grid gap-5 sm:grid-cols-2" aria-label="Available benchmarks">
      {[
        { href: "/", title: "Session Performance", Icon: RefreshCcw, description: "Compare how quickly and reliably providers create, connect, navigate, and release browser sessions—and what they cost.", metrics: "Create · Connect · Navigate · Release", detail: "Sequential and concurrent runs" },
        { href: "/proxy-get", title: "Proxy Performance", Icon: ArrowDownToLine, description: "Compare download speed, reliability, and cost through residential proxies across five countries.", metrics: "Download time · First byte · Estimated cost", detail: "5 countries · 50 attempts per provider" },
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
