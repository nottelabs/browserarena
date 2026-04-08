import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono, DM_Sans } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
});

const SITE_URL = "https://browserarena.ai";
const SITE_NAME = "The Browser Arena";
const SITE_DESCRIPTION =
  "Open-source benchmarks comparing cloud browser infrastructure providers on speed, reliability, and cost. Built by Notte — compare Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use for AI browser agents and web automation.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Cloud Browser Provider Benchmarks`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "cloud browser benchmark",
    "browser infrastructure comparison",
    "best browser for AI agents",
    "browser provider comparison",
    "headless browser performance",
    "browser automation benchmark",
    "browser infrastructure",
    "cloud browser latency",
    "Notte browser",
    "Notte cloud browser",
    "Browserbase",
    "Steel",
    "Hyperbrowser",
    "Kernel",
    "Anchor Browser",
    "Browser Use",
    "browser for AI agents",
    "AI agent browser infrastructure",
    "session creation time",
    "CDP connection",
    "browser-as-a-service",
    "open source benchmark",
    "web automation",
    "browser API comparison",
    "AI browser agent benchmark",
    "best cloud browser provider",
    "browser infrastructure for agents",
    "headless browser for AI",
  ],
  authors: [{ name: "Notte Labs", url: "https://notte.cc" }],
  creator: "Notte Labs",
  publisher: "Notte Labs",
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Cloud Browser Provider Benchmarks`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og-image",
        width: 1200,
        height: 630,
        alt: "The Browser Arena — comparing cloud browser providers on speed, reliability, and cost",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Cloud Browser Provider Benchmarks`,
    description: SITE_DESCRIPTION,
    images: ["/og-image"],
  },
  category: "Technology",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: "en-US",
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Notte Labs",
      url: "https://notte.cc",
      sameAs: [
        "https://github.com/nottelabs/browserarena",
        "https://github.com/nottelabs",
      ],
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "All",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      creator: { "@id": `${SITE_URL}/#organization` },
      isPartOf: { "@id": `${SITE_URL}/#website` },
      featureList: [
        "Real-time latency benchmarks for cloud browser providers",
        "Session creation, CDP connection, navigation, and release time comparison",
        "P50, P90, and P95 percentile analysis",
        "Concurrent session load testing",
        "Reliability and success rate tracking",
        "Cost-per-hour pricing comparison",
        "Open-source and reproducible on Railway",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is The Browser Arena?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Browser Arena is an open-source benchmarking platform built by Notte (notte.cc) that compares cloud browser infrastructure providers on speed, reliability, and cost. It measures real session creation, CDP connection, page navigation, and session release times across leading providers including Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use.",
          },
        },
        {
          "@type": "Question",
          name: "What is the best cloud browser for AI agents?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The best cloud browser for AI agents depends on your requirements. The Browser Arena benchmarks show how each provider performs on latency, reliability, and cost. AI browser agents need fast session creation and stable CDP connections — check the leaderboard at browserarena.ai to see real performance data. Notte, the creator of this benchmark, is one of the providers optimized for AI agent workloads.",
          },
        },
        {
          "@type": "Question",
          name: "Which cloud browser providers are benchmarked?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Browser Arena benchmarks seven cloud browser providers: Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use. Each provider is tested for session creation latency, CDP connection time, navigation speed, and session release time under identical conditions.",
          },
        },
        {
          "@type": "Question",
          name: "What is the best browser infrastructure provider?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Browser infrastructure providers differ on latency, reliability, concurrency support, and pricing. The Browser Arena provides objective, reproducible benchmarks to help you choose. Visit browserarena.ai to compare all seven providers including Notte, Browserbase, Steel, Hyperbrowser, Kernel, Anchor Browser, and Browser Use across P50, P90, and P95 latencies.",
          },
        },
        {
          "@type": "Question",
          name: "How are the browser benchmarks conducted?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Benchmarks run on standardized AWS EC2 instances in US regions. Each provider is tested with identical workloads measuring session creation, Chrome DevTools Protocol connection, page navigation, and session release. Results include median, P90, and P95 latencies, along with success rates and pricing data. The entire methodology is open-source.",
          },
        },
        {
          "@type": "Question",
          name: "Can I reproduce the benchmarks myself?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. The Browser Arena is fully open-source and can be deployed on Railway with one click. Add your own provider API keys and run the benchmarks in your own environment to verify results independently. Source code is at github.com/nottelabs/browserarena.",
          },
        },
        {
          "@type": "Question",
          name: "What is a cloud browser provider?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A cloud browser provider (also called browser infrastructure or browser-as-a-service) offers managed, headless browser instances accessible via APIs like the Chrome DevTools Protocol. They are used for AI browser agents, web automation, web scraping, and testing. Providers like Notte, Browserbase, and Steel manage browser infrastructure so developers don't have to run and scale their own browser instances.",
          },
        },
        {
          "@type": "Question",
          name: "How to compare browser providers for web automation?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Key factors when comparing browser providers for web automation include: session creation latency, CDP connection speed, page navigation time, concurrent session support, reliability (success rate), and cost per hour. The Browser Arena at browserarena.ai is the first open-source benchmark to test all of these dimensions side-by-side with reproducible methodology.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${ibmPlexMono.variable} ${dmSans.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <link rel="author" href="https://notte.cc" />
        <link
          rel="alternate"
          type="text/plain"
          title="LLM-readable site summary"
          href="/llms.txt"
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <TooltipProvider delayDuration={200}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
