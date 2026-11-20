import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getResultsDir } from "./data";

export const STEALTH_PROVIDERS = ["BROWSER_USE", "NOTTE", "KERNEL", "BROWSERBASE", "STEEL"] as const;
/** The fixed site-access-2 sample, alphabetical. */
export const STEALTH_SITES: readonly (readonly [name: string, domain: string])[] = [
  ["adidas", "adidas.com"], ["Allegro", "allegro.pl"], ["Best Buy", "bestbuy.com"], ["Bloomingdale's", "bloomingdales.com"],
  ["Celine", "celine.com"], ["Douglas", "douglas.de"], ["easyJet", "easyjet.com"], ["Edina Realty", "edinarealty.com"],
  ["FedEx", "fedex.com"], ["FLO", "flo.com.tr"], ["G2", "g2.com"], ["GameStop", "gamestop.com"],
  ["Hotels.com", "hotels.com"], ["idealista", "idealista.com"], ["KAYAK", "kayak.com"], ["Long Realty", "longrealty.com"],
  ["LoopNet", "loopnet.com"], ["Marriott", "marriott.com"], ["Mouser", "mouser.com"], ["Realtor.com", "realtor.com"],
  ["RealtySouth", "realtysouth.com"], ["Reddit", "reddit.com"], ["StockX", "stockx.com"], ["Target", "target.com"],
  ["Temu", "temu.com"], ["Uber Eats", "ubereats.com"], ["UPS", "ups.com"], ["Walmart", "walmart.com"],
  ["Yelp", "yelp.com"], ["Zillow", "zillow.com"],
];

export type StealthSummary = {
  schemaVersion: 1; protocol: "site-access-2"; date: string; weekOf: string;
  siteCount: 30; rounds: 3; proxyCountry: "US";
  providers: { provider: typeof STEALTH_PROVIDERS[number]; accessible: number; blocked: number; errors: number }[];
};

function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error("Invalid score fields");
}

/** Scores are data: unknown fields and unsupported protocols fail the build. */
export function parseStealth(value: unknown): StealthSummary {
  exactKeys(value, ["schemaVersion", "protocol", "date", "weekOf", "siteCount", "rounds", "proxyCountry", "providers"]);
  if (value.schemaVersion !== 1 || value.protocol !== "site-access-2" || value.siteCount !== 30 || value.rounds !== 3 || value.proxyCountry !== "US") throw new Error("Unsupported score protocol");
  for (const date of [value.date, value.weekOf]) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Invalid score date");
  }
  const monday = new Date(`${value.date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  if (monday.toISOString().slice(0, 10) !== value.weekOf || !Array.isArray(value.providers) || value.providers.length !== 5) throw new Error("Invalid score period");
  const seen = new Set<string>();
  for (const row of value.providers) {
    exactKeys(row, ["provider", "accessible", "blocked", "errors"]);
    if (!STEALTH_PROVIDERS.includes(row.provider as typeof STEALTH_PROVIDERS[number]) || seen.has(String(row.provider))) throw new Error("Invalid provider");
    seen.add(String(row.provider));
    const counts = [row.accessible, row.blocked, row.errors];
    if (counts.some(n => !Number.isSafeInteger(n) || (n as number) < 0) || (counts as number[]).reduce((a, b) => a + b, 0) !== 90) throw new Error("Invalid counts");
  }
  return value as StealthSummary;
}

export function loadStealthRuns(directory = join(getResultsDir(), "stealth")): StealthSummary[] {
  if (!existsSync(directory)) return [];
  const names = readdirSync(directory).filter(name => name !== "README.md");
  if (names.some(name => !/^\d{4}-\d{2}-\d{2}\.json$/.test(name))) throw new Error("Only aggregate result files are permitted");
  return names.map(name => {
    const run = parseStealth(JSON.parse(readFileSync(join(directory, name), "utf8")));
    if (name !== `${run.weekOf}.json`) throw new Error("Score filename does not match its period");
    return run;
  }).sort((a, b) => b.weekOf.localeCompare(a.weekOf));
}

export function rankStealth(run: StealthSummary) {
  return run.providers.map(row => ({ ...row, rate: row.accessible / (run.siteCount * run.rounds) }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.provider.localeCompare(b.provider));
}
