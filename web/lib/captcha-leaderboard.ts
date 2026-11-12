// Pure ranking for /captcha. Keep free of Node-only imports: the table is a client component.
import type { CaptchaCell, CaptchaType, PublicCampaign } from "../../src/benchmarks/captcha/publication";
import { PROVIDERS_BY_ID } from "./providers";

/** A column: the campaign's own type metadata (id, label, success signal and its label). */
export type CaptchaTypeColumn = CaptchaType;

/** What one success means under each signal, e.g. "3 of 5 accepted". */
export const SUCCESS_WORDS: Record<CaptchaType["signal"], string> = {
  server_acceptance: "accepted", token_delivery: "delivered", page_check: "passed", page_reached: "reached",
};
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

const OUTCOMES: Record<string, string> = { verified: "Accepted", token_delivered: "Token delivered", page_passed: "Passed", timeout: "Timed out", rejected: "Rejected", error: "Error", interrupted: "Interrupted" };

/** "browser-use" -> "BROWSER_USE", the ID used by the shared provider metadata. */
export const captchaProviderKey = (id: string) => id.toUpperCase().replace(/-/g, "_");

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Columns come from each campaign's protocol: v3 campaigns show three types, v4 and v5 seven. */
export function captchaColumns(campaign: PublicCampaign): CaptchaTypeColumn[] {
  return campaign.types;
}

// Each success status and the timing field it records.
const SUCCESS_TIMING = { verified: "accepted_ms", token_delivered: "token_ms", page_passed: "passed_ms" } as const;
/** " in 4.3s" for a successful attempt with its timing, so each dot's label carries its time. */
function successTime(row: PublicCampaign["attempts"][number]) {
  const field = SUCCESS_TIMING[row.status as keyof typeof SUCCESS_TIMING];
  const ms = field ? row[field] : null;
  return ms === null || ms === undefined ? "" : ` in ${(ms / 1000).toFixed(1)}s`;
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
        label: `Round ${row.round}: ${OUTCOMES[row.status]}${successTime(row)}${row.status === "error" ? ` during ${row.stage}` : ""}${row.cleanup_failed ? "; cleanup failed" : ""}` }));
      const notRun = cell?.not_run ?? 0;
      for (let index = 0; index < notRun; index++) rounds.push({ key: `not-run-${index}`, outcome: "not_run", label: "Not run" });
      return { type: column.id, successes: cell?.succeeded ?? 0, attempted: cell?.attempted ?? 0,
        medianMs: cell?.success_median_ms ?? null, rounds, notRun, cleanupErrors: cell?.cleanup_errors ?? 0 };
    });
    const times = campaign.attempts.filter(row => row.provider === provider && columns.some(column => column.id === row.type)).flatMap(row => {
      const field = SUCCESS_TIMING[row.status as keyof typeof SUCCESS_TIMING];
      const ms = field ? row[field] : null;
      return ms === null ? [] : [ms];
    });
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
