// Pure ranking for /captcha. Keep free of Node-only imports: the table is a client component.
import type { CaptchaCell, PublicCampaign } from "../../src/benchmarks/captcha/publication";
import { PROVIDERS_BY_ID } from "./providers";
// Type-only: captcha-data reads the filesystem and must stay out of client bundles.
import type { CaptchaTypeInfo } from "./captcha-data";

export type CaptchaTypeColumn = CaptchaTypeInfo;
export type CaptchaRound = { key: string; outcome: string; label: string };
export type CaptchaTypeResult = {
  type: string; successes: number; attempted: number; medianMs: number | null;
  rounds: CaptchaRound[]; notRun: number; cleanupErrors: number;
};
export type CaptchaRow = {
  provider: string; providerKey: string; name: string; logo?: string;
  rank: number | null; successes: number; attempted: number; medianMs: number | null;
  results: CaptchaTypeResult[]; unsupportedReason?: string;
  /** Benchmarked provider with no attempts in this run, e.g. "No results yet". */
  note?: string;
};

const OUTCOMES: Record<string, string> = { verified: "Accepted", token_delivered: "Token delivered", timeout: "Timed out", rejected: "Rejected", error: "Error", interrupted: "Interrupted" };

/** "browser-use" -> "BROWSER_USE", the ID used by the shared provider metadata. */
export const captchaProviderKey = (id: string) => id.toUpperCase().replace(/-/g, "_");

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Columns: types present in the campaign, in metadata order, then any unknown types. */
export function captchaColumns(cells: CaptchaCell[], metadata: CaptchaTypeColumn[]): CaptchaTypeColumn[] {
  const present = [...new Set(cells.map(cell => cell.type))];
  const known = metadata.filter(type => present.includes(type.id));
  const unknown = present.filter(type => !metadata.some(item => item.id === type)).map(type => {
    const delivery = cells.some(cell => cell.type === type && cell.token_delivered > 0);
    return { id: type, label: type, signal: delivery ? "delivery" as const : "acceptance" as const, signalLabel: delivery ? "Token delivery only" : "Server acceptance" };
  });
  return [...known, ...unknown];
}

function providerInfo(provider: string) {
  const info = PROVIDERS_BY_ID[captchaProviderKey(provider)];
  return { providerKey: captchaProviderKey(provider), name: info?.displayName ?? provider, logo: info?.logo };
}

// Ranked by success rate across every type, errors included in the denominator,
// then by the median time of successful attempts. Providers with no attempts,
// benchmarked providers missing from this run (with their note) and providers
// without native solving follow, unranked.
export function captchaLeaderboard(campaign: PublicCampaign, cells: CaptchaCell[], columns: CaptchaTypeColumn[], unsupported: Record<string, string>, notes: Record<string, string> = {}): CaptchaRow[] {
  const rows: CaptchaRow[] = campaign.providers.map(provider => {
    const results = columns.map(column => {
      const cell = cells.find(item => item.provider === provider && item.type === column.id);
      const attempts = campaign.attempts.filter(row => row.provider === provider && row.type === column.id).sort((a, b) => a.round - b.round);
      const rounds: CaptchaRound[] = attempts.map(row => ({ key: row.id, outcome: row.status,
        label: `Round ${row.round}: ${OUTCOMES[row.status]}${row.status === "error" ? ` during ${row.stage}` : ""}${row.cleanup_failed ? "; cleanup failed" : ""}` }));
      const notRun = cell?.not_run ?? 0;
      for (let index = 0; index < notRun; index++) rounds.push({ key: `not-run-${index}`, outcome: "not_run", label: "Not run" });
      return { type: column.id, successes: cell ? cell.verified + cell.token_delivered : 0, attempted: cell?.attempted ?? 0,
        medianMs: cell ? cell.accepted_median_ms ?? cell.delivered_median_ms : null, rounds, notRun, cleanupErrors: cell?.cleanup_errors ?? 0 };
    });
    const times = campaign.attempts.filter(row => row.provider === provider && columns.some(column => column.id === row.type)).flatMap(row =>
      row.status === "verified" && row.accepted_ms !== null ? [row.accepted_ms] : row.status === "token_delivered" && row.token_ms !== null ? [row.token_ms] : []);
    return { provider, ...providerInfo(provider), rank: null, results,
      successes: results.reduce((sum, result) => sum + result.successes, 0),
      attempted: results.reduce((sum, result) => sum + result.attempted, 0), medianMs: median(times) };
  });
  const rate = (row: CaptchaRow) => row.successes / row.attempted;
  const ranked = rows.filter(row => row.attempted > 0).sort((a, b) =>
    rate(b) - rate(a) || (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity) || a.name.localeCompare(b.name));
  ranked.forEach((row, index) => { row.rank = index + 1; });
  const shown = new Set(rows.map(row => row.providerKey));
  const notedRows: CaptchaRow[] = Object.entries(notes)
    .filter(([provider]) => !shown.has(captchaProviderKey(provider)) && !(provider in unsupported))
    .map(([provider, note]) => ({ provider, ...providerInfo(provider), rank: null, successes: 0, attempted: 0, medianMs: null, results: [], note }))
    .sort((a, b) => a.name.localeCompare(b.name));
  notedRows.forEach(row => shown.add(row.providerKey));
  const unsupportedRows: CaptchaRow[] = Object.entries(unsupported)
    .filter(([provider]) => !shown.has(captchaProviderKey(provider)))
    .map(([provider, reason]) => ({ provider, ...providerInfo(provider), rank: null, successes: 0, attempted: 0, medianMs: null, results: [], unsupportedReason: reason }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked, ...rows.filter(row => row.attempted === 0), ...notedRows, ...unsupportedRows];
}
