import type { ProviderClient, ProviderSession } from "../types.js";
import { sanitizeErrorMessage } from "./sanitize.js";
import { msSince, nowNs } from "./time.js";

export const MAX_SESSION_CREATE_ATTEMPTS = 3;
export const RATE_LIMIT_BACKOFF_MS = 30_000;

export interface SessionCreationDiagnostics {
  attempts: number;
  backoff_ms: number;
  elapsed_ms: number;
  errors: Array<{
    attempt: number;
    status: number | null;
    code: string | null;
    request_id: string | null;
    message: string;
  }>;
}

function errorDetails(error: unknown, attempt: number): SessionCreationDiagnostics["errors"][number] {
  const err = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; code?: unknown; requestId?: unknown } | null;
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  return {
    attempt,
    status: typeof status === "number" ? status : null,
    code: typeof err?.code === "string" ? sanitizeErrorMessage(err.code) : null,
    request_id: typeof err?.requestId === "string" ? sanitizeErrorMessage(err.requestId) : null,
    message: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
  };
}

function isTransientRateLimit(details: SessionCreationDiagnostics["errors"][number]): boolean {
  // Hyperbrowser's permanent "You have reached your credit limit" rejection
  // must not become an endless retry, even when an SDK labels it HTTP 429.
  if (/credit|quota|billing|payment|balance|subscription|(?:plan|usage|monthly|daily|spending)[ _-]+limit/i.test(`${details.code ?? ""} ${details.message}`)) {
    return false;
  }
  if (details.status !== null) return details.status === 429;
  // Legacy adapters sometimes retain only the message. Match an explicit
  // rate-limit error, rather than substrings such as "generate" or "limit".
  return /\b429\b|\brate[ _-]limit(?:ed|ing)?\b|\btoo many requests\b/i.test(details.message);
}

/** Bounded backoff for lifecycle/throughput; proxy GET remains a no-retry measurement. */
export async function createSessionWithBackoff(
  provider: Pick<ProviderClient, "name" | "create">,
  diagnostics: SessionCreationDiagnostics
): Promise<{ session: ProviderSession; creationMs: number }> {
  const started = nowNs();
  try {
    for (let attempt = 1; attempt <= MAX_SESSION_CREATE_ATTEMPTS; attempt++) {
      diagnostics.attempts = attempt;
      try {
        const t0 = nowNs();
        const session = await provider.create();
        // Preserve the existing API-call latency metric. Total time, including
        // rejected attempts and backoff, is recorded separately below.
        return { session, creationMs: msSince(t0) };
      } catch (error) {
        const details = errorDetails(error, attempt);
        diagnostics.errors.push(details);
        if (!isTransientRateLimit(details) || attempt === MAX_SESSION_CREATE_ATTEMPTS) throw error;
        console.error(`[RATE_LIMIT] provider=${provider.name} attempt=${attempt}/${MAX_SESSION_CREATE_ATTEMPTS} status=${details.status ?? "unknown"} code=${details.code ?? "unknown"} request_id=${details.request_id ?? "unknown"} message=${JSON.stringify(details.message)} → retry in 30s`);
        diagnostics.backoff_ms += RATE_LIMIT_BACKOFF_MS;
        await new Promise<void>(resolve => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS));
      }
    }
    throw new Error("Session creation attempts exhausted");
  } finally {
    diagnostics.elapsed_ms = msSince(started);
  }
}
