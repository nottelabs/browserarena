import summary from "../../results/stealth/2026-10-29.json";

export interface StealthProviderResult {
  provider: string;
  accessible: number;
  blocked: number;
  errors: number;
  sitesAccessed: number;
}

export interface StealthSummary {
  date: string;
  sites: number;
  rounds: number;
  region: string;
  providers: StealthProviderResult[];
}

export interface StealthRow extends StealthProviderResult {
  /** accessible / (accessible + blocked); errors are not a verdict on access. */
  accessRate: number | null;
  interval: [number, number] | null;
}

/** Wilson score interval for a binomial proportion. */
export function wilson(successes: number, total: number, z = 1.96): [number, number] | null {
  if (total === 0) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function rankStealth(providers: StealthProviderResult[]): StealthRow[] {
  return providers
    .map((row) => {
      const judged = row.accessible + row.blocked;
      return { ...row, accessRate: judged ? row.accessible / judged : null, interval: wilson(row.accessible, judged) };
    })
    .sort((a, b) => (b.accessRate ?? -1) - (a.accessRate ?? -1));
}

export function loadStealth(): StealthSummary {
  return summary;
}
