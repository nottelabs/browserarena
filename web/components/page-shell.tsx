import { Suspense } from "react";
import Link from "next/link";
import { GitHubLink } from "@/components/benchmark-controls";
import { Logo } from "@/components/logo";
import { HeartbeatMonitor } from "@/components/hero-animation";
import {
  Header,
  HeaderContent,
  HeaderTitle,
  HeaderDescription,
  HeaderActions,
} from "@/components/ui/header";
import { NavBar, NavBarContent, NavBarBrand, NavBarActions } from "@/components/ui/navbar";
import { Separator } from "@/components/ui/separator";
import type { VmMeta } from "@/lib/data";

export function PageShell({
  tagline,
  controls,
  caption,
  children,
}: {
  tagline: string;
  controls?: React.ReactNode;
  caption?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page-ambient min-h-screen flex flex-col">
      <NavBar>
        <NavBarContent>
          <NavBarBrand>
            <Link href="/" className="hover:opacity-80">
              <Logo size="sm" />
            </Link>
          </NavBarBrand>
          <NavBarActions>
            <GitHubLink />
          </NavBarActions>
        </NavBarContent>
      </NavBar>

      <Header>
        <HeaderContent className="reveal-fade">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <HeaderTitle className="reveal-up">Where cloud browsers compete</HeaderTitle>
              <HeaderDescription className="reveal-up reveal-up-delay-1">
                {tagline}
              </HeaderDescription>
              <HeaderActions className="reveal-up reveal-up-delay-2">
                <Suspense fallback={<div className="h-9" />}>
                  {controls}
                  {caption}
                </Suspense>
              </HeaderActions>
            </div>
            <div className="hidden lg:block shrink-0 reveal-up reveal-up-delay-2 -mr-4">
              <HeartbeatMonitor className="w-[380px] h-[270px]" />
            </div>
          </div>
        </HeaderContent>
      </Header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-6 sm:px-10 pt-4 pb-10">
        {children}
      </main>
    </div>
  );
}

export function RunItYourself() {
  return (
    <>
      <Separator className="mb-6" />
      <section className="reveal-up reveal-up-delay-2 mb-10">
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
