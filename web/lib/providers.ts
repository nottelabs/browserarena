/**
 * Single source of truth for the cloud browser providers shown on the site.
 *
 * Adding a provider here updates the leaderboard metadata, logos, and all
 * marketing copy (FAQ, SEO metadata, JSON-LD, llms.txt, OG image), including
 * the provider count. Keep this module free of Node-only imports: it is also
 * used by the edge OG image route and client components.
 */

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
    logo: "/logos/notte.jpg",
    browserRegion: "us-west-2",
    description: "Cloud browser infrastructure built for AI agents. Creator of The Browser Arena",
    marketed: true,
  },
  {
    id: "BROWSERBASE",
    displayName: "Browserbase",
    url: "https://www.browserbase.com",
    logo: "/logos/browserbase.png",
    browserRegion: "us-west-2",
    description: "Browser infrastructure for AI agents",
    marketed: true,
  },
  {
    id: "STEEL",
    displayName: "Steel",
    url: "https://www.steel.dev",
    logo: "/logos/steel.png",
    browserRegion: "us-east-1",
    description: "Browser API for AI applications",
    marketed: true,
  },
  {
    id: "HYPERBROWSER",
    displayName: "Hyperbrowser",
    url: "https://www.hyperbrowser.ai",
    logo: "/logos/hyperbrowser.png",
    browserRegion: "us-east-1",
    description: "Headless browser platform",
    marketed: true,
  },
  {
    id: "KERNEL",
    displayName: "KERNEL",
    marketingName: "Kernel",
    url: "https://www.kernel.sh",
    logo: "/logos/kernel.png",
    browserRegion: "us-east-1",
    description: "Browser runtime for agents",
    marketed: true,
  },
  {
    id: "ANCHORBROWSER",
    displayName: "Anchor Browser",
    url: "https://www.anchorbrowser.io",
    logo: "/logos/anchorbrowser.png",
    browserRegion: "us-east-1",
    description: "Cloud browser service",
    marketed: true,
  },
  {
    id: "BROWSER_USE",
    displayName: "Browser Use",
    url: "https://www.browser-use.com",
    logo: "/logos/browseruse.png",
    browserRegion: "us-east-1",
    description: "Browser automation platform",
    marketed: true,
  },
  {
    id: "LIGHTPANDA",
    displayName: "Lightpanda",
    url: "https://lightpanda.io",
    logo: "/logos/lightpanda.png",
    browserRegion: "us-west-1",
    description: "Headless browser for machines",
    marketed: true,
  },
  {
    // Beta: shown on the leaderboard but not yet in marketing copy.
    id: "TILION",
    displayName: "Tilion",
    url: "https://tilion.dev",
    logo: "/logos/tilion.png",
    browserRegion: "us-east-1",
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
