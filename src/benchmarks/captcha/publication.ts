import { configuration, schedule, summarize } from "./protocol.mjs";

export const CAMPAIGN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
export type PublicAttempt = {
  id: string; provider: string; type: string; round: number;
  status: "verified" | "token_delivered" | "rejected" | "timeout" | "error" | "interrupted";
  stage: string; accepted_ms: number | null; token_ms: number | null;
  cleanup_failed: boolean;
};
export type PublicCampaign = {
  benchmark: "captcha"; schema_version: 1; protocol_version: 2; id: string;
  started_at: string; finished_at: string; revision: string;
  providers: string[]; rounds: number; concurrency: number;
  complete: boolean; halted: boolean; interrupted: boolean; attempts: PublicAttempt[];
};

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as RecordValue;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid campaign timestamp");
  return new Date(value).toISOString();
}
function duration(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid attempt duration");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean");
  return value;
}

// Rebuild the entire public object: raw provider payloads, session IDs, hostnames,
// screenshots, error strings, and arbitrary future fields never cross this boundary.
export function validateCampaign(input: unknown): PublicCampaign {
  const raw = object(input);
  if (raw.benchmark !== "captcha" || raw.schema_version !== 1 || raw.protocol_version !== 2)
    throw new Error("Unsupported CAPTCHA campaign protocol/schema");
  if (typeof raw.id !== "string" || !CAMPAIGN_ID.test(raw.id)) throw new Error("Invalid campaign ID");
  if (typeof raw.revision !== "string" || !/^[a-f0-9]{40}$/.test(raw.revision)) throw new Error("Invalid source revision");
  const config = configuration({ providers: raw.providers, rounds: raw.rounds, concurrency: raw.concurrency });
  const planned = new Map(schedule(config).flat().map(task => [task.id, task]));
  if (!Array.isArray(raw.attempts)) throw new Error("Expected attempts");
  const seen = new Set<string>();
  const attempts: PublicAttempt[] = raw.attempts.map(value => {
    const row = object(value);
    const task = typeof row.id === "string" ? planned.get(row.id) : undefined;
    if (!task || seen.has(task.id) || row.provider !== task.provider || row.type !== task.fixture.type || row.round !== task.round)
      throw new Error("Duplicate or unplanned attempt");
    seen.add(task.id);
    const statuses = ["verified", "token_delivered", "rejected", "timeout", "error", "interrupted"];
    if (typeof row.status !== "string" || !statuses.includes(row.status)) throw new Error("Invalid attempt status");
    if (row.status === "verified" && row.type === "hcaptcha" || row.status === "token_delivered" && row.type !== "hcaptcha")
      throw new Error("Token delivery and server acceptance cannot be interchanged");
    if (typeof row.stage !== "string" || !["create", "connect", "navigate", "solve", "verify"].includes(row.stage)) throw new Error("Invalid attempt stage");
    const accepted_ms = duration(row.accepted_ms), token_ms = duration(row.token_ms);
    if (row.status === "verified" && accepted_ms === null || row.status === "token_delivered" && token_ms === null)
      throw new Error("Successful attempt missing its timing");
    if (row.status !== "verified" && accepted_ms !== null) throw new Error("Unaccepted attempt has acceptance timing");
    return { id: task.id, provider: task.provider, type: task.fixture.type, round: task.round,
      status: row.status as PublicAttempt["status"], stage: row.stage, accepted_ms, token_ms,
      cleanup_failed: boolean(row.cleanup_failed) };
  });
  const complete = boolean(raw.complete);
  if (complete !== (attempts.length === planned.size)) throw new Error("Campaign completion disagrees with the declared plan");
  const started_at = timestamp(raw.started_at), finished_at = timestamp(raw.finished_at);
  if (finished_at < started_at) throw new Error("Campaign ends before it starts");
  return { benchmark: "captcha", schema_version: 1, protocol_version: 2, id: raw.id,
    started_at, finished_at, revision: raw.revision,
    providers: config.providers, rounds: config.rounds, concurrency: config.concurrency,
    complete, halted: boolean(raw.halted), interrupted: boolean(raw.interrupted), attempts };
}

export function exportCampaign(id: string, summaryInput: unknown, rows: unknown[]): PublicCampaign {
  const summary = object(summaryInput), config = object(summary.configuration);
  if (config.version !== 2) throw new Error("Only protocol v2 can be exported");
  // Reject fixture or timing drift instead of mislabeling it as the same protocol.
  const expected = configuration({ providers: config.providers, rounds: config.rounds, concurrency: config.concurrency });
  for (const key of ["fixtures", "viewport", "solveTimeoutMs", "cooldownMs", "navigationTimeoutMs", "retries"] as const)
    if (JSON.stringify(config[key]) !== JSON.stringify(expected[key])) throw new Error(`Protocol drift: ${key}`);
  return validateCampaign({ benchmark: "captcha", schema_version: 1, protocol_version: 2, id,
    started_at: config.started_at, finished_at: summary.finished_at, revision: config.browserarena_sha,
    providers: config.providers, rounds: config.rounds, concurrency: config.concurrency,
    complete: summary.complete, halted: summary.halted, interrupted: summary.interrupted,
    attempts: rows.map(value => {
      const row = object(value), cleanup = object(row.cleanup);
      return { id: row.id, provider: row.provider, type: row.type, round: row.round,
        status: row.status, stage: row.stage, accepted_ms: row.accepted_ms, token_ms: row.token_ms,
        cleanup_failed: !!(row.session_id && cleanup.released !== true || cleanup.disconnect_error) };
    }),
  });
}

export type CaptchaCell = {
  provider: string; type: string; planned: number; attempted: number;
  verified: number; token_delivered: number; timeout: number; rejected: number;
  error: number; interrupted: number; cleanup_errors: number; not_run: number;
  acceptance_interval_95: [number, number] | null; delivery_interval_95: [number, number] | null;
  delivered_median_ms: number | null; accepted_median_ms: number | null;
};
export function campaignCells(campaign: PublicCampaign): CaptchaCell[] {
  return summarize(configuration({ providers: campaign.providers, rounds: campaign.rounds, concurrency: campaign.concurrency }),
    campaign.attempts.map(row => ({ ...row, cleanup: row.cleanup_failed ? { disconnect_error: true } : {} })));
}
