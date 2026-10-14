"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Menu, X } from "lucide-react";
import { COUNTRY_NAMES, PROXY_COUNTRIES } from "../../../src/benchmarks/proxy-get/schema";
import styles from "./sidebar.module.css";
import { BenchmarkLink } from "./benchmark-navigation";
import { BENCHMARK_TITLES } from "./benchmark-title";

const FLAGS = { US: "🇺🇸", FR: "🇫🇷", BR: "🇧🇷", IN: "🇮🇳", JP: "🇯🇵" };

const PAGE_SECTIONS = [
  { id: "lifecycle", label: BENCHMARK_TITLES["hello-browser"] },
  { id: "proxy", label: BENCHMARK_TITLES["proxy-get"] },
  { id: "throughput", label: BENCHMARK_TITLES["browser-throughput"] },
] as const;

export function BenchmarkSidebar({ benchmark, country, concurrency, concurrencyLevels, date, simulated, proxyBasePath = "/test", publicRoutes = false, lifecycleQuery = "", sort, inPage = false }: {
  benchmark: "hello-browser" | "proxy-get" | "browser-throughput" | "all";
  country: (typeof PROXY_COUNTRIES)[number];
  concurrency: number;
  concurrencyLevels: number[];
  date?: string;
  simulated: boolean;
  proxyBasePath?: string;
  publicRoutes?: boolean;
  lifecycleQuery?: string;
  sort?: string;
  inPage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sectionId, setSectionId] = useState<(typeof PAGE_SECTIONS)[number]["id"]>("lifecycle");
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!inPage) return;
    const update = () => {
      let current: (typeof PAGE_SECTIONS)[number]["id"] = "lifecycle";
      let nearest = -Infinity;
      for (const section of PAGE_SECTIONS) {
        const node = document.getElementById(section.id);
        if (!node) continue;
        const top = node.getBoundingClientRect().top;
        if (top <= 140 && top > nearest) {
          nearest = top;
          current = section.id;
        }
      }
      setSectionId(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [inPage]);
  useEffect(() => {
    if (!open) return;
    const drawer = window.matchMedia("(max-width: 1279px)");
    if (!drawer.matches) return;
    const closeOnDesktop = () => { if (!drawer.matches) setOpen(false); };
    drawer.addEventListener("change", closeOnDesktop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button") ?? []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      drawer.removeEventListener("change", closeOnDesktop);
      menuRef.current?.focus();
    };
  }, [open]);
  const linkClass = (active: boolean) => `${styles.option} ${active ? styles.active : ""}`;
  const countryHref = (country: string) => {
    const query = new URLSearchParams({ country });
    if (!publicRoutes) { query.set("benchmark", "proxy-get"); query.set("demo", simulated ? "1" : "0"); }
    if (sort === "cost") query.set("sort", "cost");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) query.set("date", date);
    return `${proxyBasePath}?${query}`;
  };
  const throughputHref = (level?: number) => {
    const query = new URLSearchParams();
    if (level !== undefined && level !== 1) query.set("concurrency", String(level));
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) query.set("date", date);
    const qs = query.toString();
    return `/throughput${qs ? `?${qs}` : ""}`;
  };
  const runModeHref = (level: number) => (benchmark === "browser-throughput" ? throughputHref(level) : lifecycleHref(level));
  const lifecycleHref = (level?: number) => {
    const query = new URLSearchParams(lifecycleQuery);
    if (!publicRoutes) query.set("benchmark", "hello-browser");
    if (level !== undefined) query.set("concurrency", String(level));
    return `${publicRoutes ? "/" : "/test"}${query.size ? `?${query}` : ""}`;
  };
  return <>
    <button ref={menuRef} className={styles.menuButton} type="button" aria-expanded={open} aria-controls="test-benchmark-sidebar" data-in-page={inPage ? "true" : undefined} onClick={() => setOpen(!open)}>
      <Menu className="size-4" aria-hidden="true" />{inPage ? "On this page" : "Benchmark & setup"}
    </button>
    {open && <button type="button" className={styles.backdrop} aria-label="Close benchmark sidebar" onClick={() => setOpen(false)} />}
    <aside ref={sidebarRef} id="test-benchmark-sidebar" className={styles.sidebar} data-open={open} data-in-page={inPage ? "true" : undefined} aria-label={inPage ? "On this page" : "Benchmark and setup"}>
      <button className={styles.closeButton} type="button" aria-label="Close benchmark sidebar" onClick={() => setOpen(false)}><X className="size-4" /></button>
      <section>
        <h2 className={styles.label}>{inPage ? "On this page" : "Benchmark"}</h2>
        <nav className={styles.options} aria-label={inPage ? "Jump to a section" : "Choose benchmark"}>
          {inPage ? PAGE_SECTIONS.map((section) => <a key={section.id} href={`#${section.id}`} className={linkClass(sectionId === section.id)} aria-current={sectionId === section.id ? "location" : undefined} onClick={() => setOpen(false)}>{section.label}</a>) : <>
          <Link href={lifecycleHref()} prefetch={true} className={linkClass(benchmark === "hello-browser")} aria-current={benchmark === "hello-browser" ? "page" : undefined} onClick={() => setOpen(false)}>{BENCHMARK_TITLES["hello-browser"]}</Link>
          <Link href={publicRoutes ? "/proxies" : `${proxyBasePath}?benchmark=proxy-get&demo=${simulated ? "1" : "0"}`} prefetch={true} className={linkClass(benchmark === "proxy-get")} aria-current={benchmark === "proxy-get" ? "page" : undefined} onClick={() => setOpen(false)}>{BENCHMARK_TITLES["proxy-get"]}</Link>
          <Link href="/throughput" prefetch={true} className={linkClass(benchmark === "browser-throughput")} aria-current={benchmark === "browser-throughput" ? "page" : undefined} onClick={() => setOpen(false)}>{BENCHMARK_TITLES["browser-throughput"]}</Link>
          </>}
        </nav>
      </section>
      {benchmark !== "all" && <section className={styles.config}>
        <h2 className={styles.label}>Setup</h2>
        <nav className={styles.options} aria-label={benchmark === "proxy-get" ? "Proxy country" : "Run mode"}>
          {benchmark === "proxy-get" ? PROXY_COUNTRIES.map(c => <BenchmarkLink key={c} href={countryHref(c)} className={linkClass(c === country)} aria-current={c === country ? "page" : undefined} onClick={() => setOpen(false)}>
            <span className={styles.flag} aria-hidden="true">{FLAGS[c]}</span>{COUNTRY_NAMES[c]}
          </BenchmarkLink>) : concurrencyLevels.map(c => <BenchmarkLink key={c} href={runModeHref(c)} className={linkClass(c === concurrency)} aria-current={c === concurrency ? "page" : undefined} onClick={() => setOpen(false)}>
            <span className={styles.optionLine}>{c === 1 ? "Sequential runs" : `Concurrent runs c=${c}`}</span>
          </BenchmarkLink>)}
        </nav>
      </section>}
      {!publicRoutes && <Link href="/test?benchmark=all" className={styles.allLink} onClick={() => setOpen(false)}><ArrowLeft className="size-3.5" aria-hidden="true" />All benchmarks</Link>}
    </aside>
  </>;
}
