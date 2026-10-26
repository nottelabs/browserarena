/**
 * Single source of truth for the cloud browser providers shown on the site.
 *
 * Adding a provider here updates the leaderboard metadata, logos, and all
 * marketing copy (FAQ, SEO metadata, JSON-LD, llms.txt, OG image), including
 * the provider count. Keep this module free of Node-only imports: it is also
 * used by the edge OG image route and client components.
 */

import { PROVIDER_LOGO_SRC } from "./provider-logos";

export interface ProviderInfo {
  /** Provider identifier as written in results (`entry.provider`). */
  id: string;
  /** Name shown on the leaderboard. */
  displayName: string;
  /** Name used in prose, when it differs from `displayName`. */
  marketingName?: string;
  url: string;
  logo?: string;
  browserRegion?: string;
  disclaimer?: string;
  /** One-line description used in llms.txt. */
  description?: string;
  /** Whether the provider is listed (and counted) in marketing copy. */
  marketed: boolean;
}

/** Ordered as the providers appear in marketing copy. */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: "NOTTE",
    displayName: "Notte",
    url: "https://www.notte.cc",
    logo: PROVIDER_LOGO_SRC.NOTTE,
    browserRegion: "us-west-2",
    description: "Cloud browser infrastructure built for AI agents. Creator of The Browser Arena",
    marketed: true,
  },
  {
    id: "BROWSERBASE",
    displayName: "Browserbase",
    url: "https://www.browserbase.com",
    logo: PROVIDER_LOGO_SRC.BROWSERBASE,
    browserRegion: "us-west-2",
    description: "Browser infrastructure for AI agents",
    marketed: true,
  },
  {
    id: "STEEL",
    displayName: "Steel",
    url: "https://www.steel.dev",
    logo: PROVIDER_LOGO_SRC.STEEL,
    browserRegion: "us-east-1",
    description: "Browser API for AI applications",
    marketed: true,
  },
  {
    id: "HYPERBROWSER",
    displayName: "Hyperbrowser",
    url: "https://www.hyperbrowser.ai",
    logo: PROVIDER_LOGO_SRC.HYPERBROWSER,
    browserRegion: "us-east-1",
    description: "Headless browser platform",
    marketed: true,
  },
  {
    id: "KERNEL",
    displayName: "KERNEL",
    marketingName: "Kernel",
    url: "https://www.kernel.sh",
    logo: PROVIDER_LOGO_SRC.KERNEL,
    browserRegion: "us-east-1",
    description: "Browser runtime for agents",
    marketed: true,
  },
  {
    id: "ANCHORBROWSER",
    displayName: "Anchor Browser",
    url: "https://www.anchorbrowser.io",
    logo: PROVIDER_LOGO_SRC.ANCHORBROWSER,
    browserRegion: "us-east-1",
    description: "Cloud browser service",
    marketed: true,
  },
  {
    id: "BROWSER_USE",
    displayName: "Browser Use",
    url: "https://www.browser-use.com",
    logo: PROVIDER_LOGO_SRC.BROWSER_USE,
    browserRegion: "us-east-1",
    description: "Browser automation platform",
    marketed: true,
  },
  {
    id: "LIGHTPANDA",
    displayName: "Lightpanda",
    url: "https://lightpanda.io",
    logo: PROVIDER_LOGO_SRC.LIGHTPANDA,
    browserRegion: "us-west-1",
    description: "Headless browser for machines",
    marketed: true,
  },
  {
    // Beta: shown on the leaderboard but not yet in marketing copy.
    id: "TILION",
    displayName: "Tilion",
    url: "https://tilion.dev",
    logo: PROVIDER_LOGO_SRC.TILION,
    browserRegion: "us-east-1",
    marketed: false,
  },
  // Adapters only so far: no published results yet, so not in marketing copy.
  {
    id: "BROWSERLESS",
    displayName: "Browserless",
    url: "https://www.browserless.io",
    logo: PROVIDER_LOGO_SRC.BROWSERLESS,
    browserRegion: "us-west",
    marketed: false,
  },
  {
    id: "CLOUDFLARE",
    displayName: "Cloudflare",
    marketingName: "Cloudflare Browser Run",
    url: "https://developers.cloudflare.com/browser-run/",
    logo: PROVIDER_LOGO_SRC.CLOUDFLARE,
    browserRegion: "global",
    marketed: false,
  },
  {
    id: "AWS_AGENTCORE",
    displayName: "AWS AgentCore",
    marketingName: "Amazon Bedrock AgentCore Browser",
    url: "https://aws.amazon.com/bedrock/agentcore/",
    logo: PROVIDER_LOGO_SRC.AWS_AGENTCORE,
    browserRegion: "us-east-1",
    marketed: false,
  },
  {
    id: "GOLOGIN",
    displayName: "GoLogin",
    marketingName: "GoLogin Cloud Browser",
    url: "https://gologin.com/cloud-browser/",
    logo: PROVIDER_LOGO_SRC.GOLOGIN,
    browserRegion: "provider-default",
    marketed: false,
  },
];

export const PROVIDERS_BY_ID: Record<string, ProviderInfo> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);

export const MARKETED_PROVIDERS = PROVIDERS.filter((p) => p.marketed);

export function providerName(p: ProviderInfo): string {
  return p.marketingName ?? p.displayName;
}

/** URL segment for `/provider/tilion`. Derived from the leaderboard name. */
export function providerSlug(provider: Pick<ProviderInfo, "displayName">): string {
  return provider.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function providerFromSlug(slug: string): ProviderInfo | undefined {
  return PROVIDERS.find((provider) => providerSlug(provider) === slug);
}

export function providerPath(id: string): string | null {
  const provider = PROVIDERS_BY_ID[id];
  return provider ? `/provider/${providerSlug(provider)}` : null;
}

/** "notte.cc" for "https://www.notte.cc". */
export function providerDomain(p: ProviderInfo): string {
  return new URL(p.url).hostname.replace(/^www\./, "");
}

export const MARKETED_PROVIDER_NAMES = MARKETED_PROVIDERS.map(providerName);

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];

/** 7 -> "seven"; falls back to digits past twenty. */
export function numberToWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Oxford-comma join: "A", "A and B", "A, B, and C". */
export function joinList(items: string[], conjunction: "and" | "or" = "and"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

/** e.g. "seven" */
export const PROVIDER_COUNT_WORD = numberToWord(MARKETED_PROVIDERS.length);

/** e.g. "Notte, Browserbase, ..., and Browser Use" */
export const PROVIDER_LIST = joinList(MARKETED_PROVIDER_NAMES);

/** e.g. "Notte, Browserbase, ..., or Browser Use" */
export const PROVIDER_LIST_OR = joinList(MARKETED_PROVIDER_NAMES, "or");
