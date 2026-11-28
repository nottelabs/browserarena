import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ProviderClient, ProviderSession, SessionOptions } from "../types.js";
import { SessionCreationError } from "../types.js";
import { requireEnv } from "../utils/env.js";
import { msSince, nowNs } from "../utils/time.js";

const API_BASE = "https://cloudbrowser.tv/api/v1";
const BASIC_OVERAGE_PER_HOUR = 0.08;
const REQUEST_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;

type Operation = { id: string; browserId: string; status: string };

class CloudbrowserApiError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Cloudbrowser API failed: HTTP ${status}${code ? ` (${code})` : ""}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const key = requireEnv("CLOUDBROWSER_API_KEY");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${key}`);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init, headers, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    // Keep recognized API error codes, never a raw upstream response or credential.
    throw new CloudbrowserApiError(response.status,
      typeof code === "string" && /^[a-z_]{1,50}$/.test(code) && !code.includes(key) ? code : undefined);
  }
  return await response.json() as T;
}

async function waitForOperation(initial: Operation): Promise<void> {
  const id = initial.id;
  if (typeof id !== "string" || !id) throw new Error("Cloudbrowser returned no operation ID");
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  let operation = initial;
  while (operation.status === "running" || operation.status === "pending") {
    if (Date.now() >= deadline) throw new Error("Cloudbrowser operation timed out");
    await delay(POLL_INTERVAL_MS);
    operation = await request<Operation>(`/operations/${encodeURIComponent(id)}`);
  }
  if (operation.status !== "succeeded") {
    throw new Error("Cloudbrowser operation did not succeed");
  }
}

export class CloudbrowserProvider implements ProviderClient {
  readonly name = "CLOUDBROWSER";
  readonly proxyUnsupportedReason = "Cloudbrowser does not expose country selection for this benchmark";

  computeCost(seconds: number): number {
    return Math.round(seconds / 3600 * BASIC_OVERAGE_PER_HOUR * 1e8) / 1e8;
  }

  async create(opts?: SessionOptions): Promise<ProviderSession> {
    if (opts?.proxyCountry) throw new Error(this.proxyUnsupportedReason);
    const idempotencyKey = randomUUID();
    const startBrowser = () => request<Operation>("/browsers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ name: `BrowserArena ${idempotencyKey}` }),
    });
    let operation: Operation;
    try {
      operation = await startBrowser();
    } catch (error) {
      // A request timeout can occur after the API accepted the operation.
      // Replaying the same request recovers its ID without creating a second browser.
      if (!(error instanceof TypeError) &&
        (!(error instanceof Error) || error.name !== "TimeoutError")) throw error;
      operation = await startBrowser();
    }
    const id = operation.browserId;
    if (typeof id !== "string" || !id) throw new Error("Cloudbrowser returned no browser ID");

    try {
      await waitForOperation(operation);
      const { cdpUrl } = await request<{ cdpUrl?: unknown }>(`/browsers/${encodeURIComponent(id)}/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: "cdp", permission: "control" }),
      });
      if (typeof cdpUrl !== "string" || !URL.canParse(cdpUrl) || new URL(cdpUrl).protocol !== "wss:") {
        throw new Error("Cloudbrowser returned no secure CDP endpoint");
      }
      return { id, cdpUrl };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Cloudbrowser session creation failed";
      const started = nowNs();
      try {
        await this.release(id);
      } catch (cleanupError) {
        throw new SessionCreationError(reason, id,
          cleanupError instanceof Error ? cleanupError.message : "Cloudbrowser cleanup failed", null);
      }
      throw new SessionCreationError(reason, id, null, msSince(started));
    }
  }

  async release(id: string): Promise<void> {
    const deadline = Date.now() + OPERATION_TIMEOUT_MS;
    const key = randomUUID();
    while (true) {
      let operation: Operation;
      try {
        operation = await request<Operation>(`/browsers/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "Idempotency-Key": key },
        });
      } catch (error) {
        if (!(error instanceof CloudbrowserApiError)) throw error;
        if (error.status === 404) return;
        // Deletion can be busy while an already accepted create operation settles.
        if (error.code !== "busy" || Date.now() >= deadline) throw error;
        await delay(POLL_INTERVAL_MS);
        continue;
      }
      await waitForOperation(operation);
      return;
    }
  }
}
