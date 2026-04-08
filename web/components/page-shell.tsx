import Link from "next/link";
import { GitHubLink } from "@/components/benchmark-controls";
import { Logo } from "@/components/logo";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import { Separator } from "@/components/ui/separator";
import type { VmMeta } from "@/lib/data";

export function PageShell({
  children,
}: {
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
            <nav className="hidden sm:flex items-center gap-8 text-sm font-medium">
              <a href="#leaderboard" className="text-muted-foreground hover:text-foreground transition-colors">Leaderboard</a>
              <a href="https://github.com/nottelabs/browserarena" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">Methodology</a>
              <a href="https://railway.com/deploy/UNedGj" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">Reproduce</a>
            </nav>
            <a
              href="https://join.slack.com/t/nottelabs-dev/shared_invite/zt-39a8n6hr9-d_BG7RNfytimSpVo5H03mA"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Join Slack Community"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" />
              </svg>
            </a>
            <GitHubLink />
          </NavBarActions>
        </NavBarContent>
      </NavBar>

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-10 pt-6 sm:pt-10 pb-5 sm:pb-10">
        <section className="mb-4 sm:mb-10">
          <div className="sm:hidden flex justify-center mb-3">
            <span className="rounded-[3px] bg-purple-500/15 px-3 py-1 text-[0.68rem] font-semibold text-purple-600 tracking-wide">
              Open site on desktop to see full evaluations
            </span>
          </div>
          <h1 className="hidden sm:block text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
            The Browser Arena
          </h1>
          <p className="mt-0 sm:mt-3 sm:max-w-2xl text-[0.78rem] sm:text-sm leading-relaxed text-muted-foreground">
            Comparing cloud browser infrastructure providers
            <br className="sm:hidden" />
            on speed, reliability, and cost.{' '}
            <br className="hidden sm:block" />
            Open-source and reproducible on Railway. Built by{' '}
            <a href="https://notte.cc" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">Notte</a>.
          </p>
        </section>
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
