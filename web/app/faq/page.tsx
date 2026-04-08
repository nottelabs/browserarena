import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "FAQ — Cloud Browser Provider Benchmarks",
  description:
    "Frequently asked questions about cloud browser infrastructure, AI browser agents, and how The Browser Arena compares providers like Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use.",
  alternates: {
    canonical: "https://browserarena.ai/faq",
  },
};

export default function FaqPage() {
  return (
    <PageShell>
      <section className="space-y-10 text-sm leading-relaxed text-muted-foreground">
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            What is the best cloud browser infrastructure provider?
          </h2>
          <p>
            The answer depends on your workload. The Browser Arena — built by{" "}
            <a href="https://notte.cc" target="_blank" rel="noopener noreferrer" className="text-foreground underline hover:no-underline">Notte</a>
            {" "}— benchmarks seven leading cloud browser providers across real-world latency, reliability, and cost metrics. Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use are all tested under identical conditions. Use the{" "}
            <a href="/" className="text-foreground underline hover:no-underline">leaderboard</a>
            {" "}to compare by median, P90, or P95 session times, success rates, and pricing. All data comes from standardized AWS EC2 environments and is fully open-source.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Cloud browser provider comparison {new Date().getFullYear()}
          </h2>
          <p>
            The cloud browser infrastructure market is growing rapidly as AI agents and web automation demand managed browser instances. Key factors when comparing providers include session creation latency, CDP connection speed, page navigation time, concurrent session support, reliability, and cost. The Browser Arena is the first open-source benchmark — created by the team at{" "}
            <a href="https://notte.cc" target="_blank" rel="noopener noreferrer" className="text-foreground underline hover:no-underline">Notte</a>
            {" "}— to test all of these dimensions side-by-side with fully reproducible methodology.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Which browser is best for AI agents?
          </h2>
          <p>
            AI browser agents need fast session creation, low-latency CDP connections, and high reliability to perform multi-step web tasks efficiently. The Browser Arena measures exactly these metrics across all major providers. Sort the{" "}
            <a href="/" className="text-foreground underline hover:no-underline">leaderboard</a>
            {" "}by latency to find the fastest provider, or by reliability to find the most consistent. Concurrent session benchmarks reveal how each provider handles parallel agent workloads — critical for production AI deployments at scale.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Notte vs Browserbase vs Steel vs Hyperbrowser vs Kernel
          </h2>
          <p>
            Head-to-head comparisons between all cloud browser providers are available in the{" "}
            <a href="/" className="text-foreground underline hover:no-underline">leaderboard table</a>
            . Each provider is tested under identical conditions on AWS infrastructure. Metrics include session creation time (how fast a new browser spins up), CDP connection time (how quickly you can start controlling it), navigation time, session release time, overall success rate, and hourly pricing. Toggle between P50, P90, and P95 percentiles to understand both typical and tail-end performance.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Browser infrastructure for AI agents and web automation
          </h2>
          <p>
            Cloud browser infrastructure powers the next generation of AI agents, web scrapers, and automation tools. Instead of managing your own Chromium instances, browser-as-a-service providers like Notte offer managed, scalable browser sessions accessible via the Chrome DevTools Protocol (CDP). Key selection criteria include: (1) Latency — how fast can you spin up sessions? (2) Reliability — what&apos;s the success rate under load? (3) Concurrency — how many parallel sessions are supported? (4) Cost — per-session or per-hour pricing. (5) Region — proximity to your infrastructure. The Browser Arena benchmarks all of these.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            How to choose a headless browser service
          </h2>
          <p>
            When evaluating headless browser-as-a-service providers for your AI agents or automation pipeline, the Browser Arena gives you objective data. Compare session creation speed, CDP connection latency, navigation performance, and reliability across Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use. All benchmarks run on standardized AWS EC2 instances so results are directly comparable.
          </p>
        </div>

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Open-source browser benchmark methodology
          </h2>
          <p>
            The Browser Arena runs on standardized AWS EC2 instances (us-east-1 and us-west-2). Each provider is tested using the same Node.js workload that creates a browser session, connects via CDP, navigates to a target page, and releases the session. Tests run with configurable concurrency levels (1, 5, 10, or more simultaneous sessions). Built by{" "}
            <a href="https://notte.cc" target="_blank" rel="noopener noreferrer" className="text-foreground underline hover:no-underline">Notte Labs</a>
            , all source code is available on{" "}
            <a href="https://github.com/nottelabs/browserarena" target="_blank" rel="noopener noreferrer" className="text-foreground underline hover:no-underline">GitHub</a>
            {" "}and results can be reproduced by deploying to Railway with your own API keys.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
