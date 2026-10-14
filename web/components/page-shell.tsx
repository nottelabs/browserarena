import Link from "next/link";
import { GitHubLink } from "@/components/benchmark-controls";
import { ResourcesMenu } from "@/components/resources-menu";
import { Logo } from "@/components/logo";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import { Separator } from "@/components/ui/separator";
import type { VmMeta } from "@/lib/data";

export function PageShell({
  children,
  benchmark = "hello-browser",
}: {
  benchmark?: "hello-browser" | "proxy-get";
  tagline?: string;
  caption?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="page-ambient min-h-screen flex flex-col"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, transparent, transparent 9px, var(--border) 9px, var(--border) 10px)",
      }}
    >
      <NavBar>
        <NavBarContent>
          <NavBarBrand>
            <Link href="/" className="hover:opacity-80">
              <Logo size="lg" />
            </Link>
          </NavBarBrand>
          <NavBarActions>
            <ResourcesMenu />
            <GitHubLink />
          </NavBarActions>
        </NavBarContent>
      </NavBar>

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 sm:pt-5 pb-5 sm:pb-10">
        <section className="mb-4 sm:mb-5">
          {benchmark === "hello-browser" && <div className="sm:hidden flex justify-center mb-3">
            <span className="rounded-[3px] bg-purple-500/15 px-3 py-1 text-[0.68rem] font-semibold text-purple-600 tracking-wide">
              Open site on desktop to see full evaluations
            </span>
          </div>}
          <h1 className="hidden sm:block text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
            The Browser Arena
          </h1>
          <p className="mt-0 sm:mt-2 sm:max-w-2xl text-[0.78rem] sm:text-sm leading-relaxed text-muted-foreground">
            Comparing cloud browser infrastructure providers{' '}
            <br className="sm:hidden" />
            on speed, reliability, and cost.
          </p>
        </section>
        <nav aria-label="Benchmarks" className="mb-6 flex gap-5 text-sm font-medium">
          <Link href="/" aria-current={benchmark === "hello-browser" ? "page" : undefined}
            className={benchmark === "hello-browser" ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}>Browser Lifecycle</Link>
          <Link href="/proxies" aria-current={benchmark === "proxy-get" ? "page" : undefined}
            className={benchmark === "proxy-get" ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}>Proxy Performance</Link>
        </nav>
        {children}
      </main>

    </div>
  );
}

export function RunItYourself() {
  return (
    <>
      <Separator className="mb-6" />
      <section id="reproduce" className="reveal-up reveal-up-delay-2 mb-10 scroll-mt-20">
        <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium mb-3">
          Run it yourself
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mb-5">
          Reproduce these benchmarks in your own environment. Deploy to Railway, add your provider API keys, and get results in minutes.
        </p>
        <a
          href="https://railway.com/deploy/UNedGj?referralCode=YUwE3Q&utm_medium=integration&utm_source=template&utm_campaign=generic"
          target="_blank"
          rel="noopener noreferrer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://railway.com/button.svg"
            alt="Deploy on Railway"
            className="h-9"
          />
        </a>
      </section>
    </>
  );
}

export function TestEnvironment({ vmMetas }: { vmMetas: VmMeta[] }) {
  if (vmMetas.length === 0) return null;
  return (
    <div className="shrink-0">
      <h2 className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-medium mb-3">
        Test Environment
      </h2>
      <div className="flex flex-col gap-3">
        {vmMetas.map((vm, i) => (
          <div key={i} className="flex flex-col gap-1 text-[0.72rem] font-mono text-muted-foreground">
            {vm.cloud && vm.region && (
              <span>{vm.cloud.toUpperCase()} {vm.region}</span>
            )}
            {(vm.instance_type || vm.os) && (
              <span>
                {[vm.instance_type, vm.os].filter(Boolean).join(" · ")}
              </span>
            )}
            {vm.node_version && (
              <span>Node {vm.node_version}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
