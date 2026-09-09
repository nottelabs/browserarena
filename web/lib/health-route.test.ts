/**
 * Integration tests for the /api/health route handler.
 *
 * These drive the real exported `GET` against the real committed results —
 * route -> regression detector -> data loader -> filesystem — with no mocks and
 * no dev server. They cover the contract an external uptime monitor depends on:
 * the HTTP status code, the headers, and parameter validation.
 *
 * IMPORTANT: assertions here must be time-independent. The route evaluates the
 * real wall clock against fixed committed data, so any test that hardcodes a
 * verdict ("Notte is degraded", "Steel is ok") starts failing on its own once
 * the results age past `stalenessHours` — CI breaking purely as time passes.
 * So these assert the status -> HTTP mapping as an invariant, and leave
 * verdict-specific assertions to `regression.test.ts`, which passes an explicit
 * clock and can safely pin exact numbers.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/api/health/route";
import type { HealthStatus } from "@/lib/regression";

const BASE = "http://localhost/api/health";

/** The contract every monitor relies on: non-2xx exactly when action is needed. */
const EXPECTED_CODE: Record<HealthStatus, number> = {
  ok: 200,
  unknown: 200, // cold start must never page
  degraded: 503,
  stale: 503,
};

async function get(query = "") {
  const res = await GET(new Request(`${BASE}${query}`));
  return { res, body: await res.json() };
}

test("status and HTTP code always agree, whatever today's data says", async () => {
  for (const query of ["", "?provider=steel", "?provider=notte", "?provider=all"]) {
    const { res, body } = await get(query);
    const status = body.status as HealthStatus;

    assert.ok(status in EXPECTED_CODE, `unexpected status "${status}" for ${query}`);
    assert.equal(res.status, EXPECTED_CODE[status], `wrong code for ${query} (${status})`);
    assert.equal(res.headers.get("x-health-status"), status, `header mismatch for ${query}`);
  }
});

test("failing responses are retryable and only briefly cached", async () => {
  const { res, body } = await get("?provider=all");

  if (res.status !== 503) {
    // Everything is healthy right now; the invariant above already covered it.
    assert.ok(["ok", "unknown"].includes(body.status));
    return;
  }

  assert.equal(res.headers.get("retry-after"), "3600");

  // A regression stays open for days. no-store would make every uptime check
  // re-parse the full result history for the entire incident.
  const cacheControl = res.headers.get("cache-control") ?? "";
  assert.ok(!cacheControl.includes("no-store"), `got: ${cacheControl}`);
  assert.match(cacheControl, /s-maxage=60/);
});

test("healthy responses are CDN-cacheable for five minutes", async () => {
  const { res, body } = await get("?provider=steel");

  if (res.status === 200) {
    assert.equal(
      res.headers.get("cache-control"),
      "public, s-maxage=300, stale-while-revalidate=600"
    );
  } else {
    assert.ok(["degraded", "stale"].includes(body.status));
  }
});

test("a degraded series always names at least one breach", async () => {
  const { body } = await get("?provider=all");

  for (const series of body.series) {
    if (series.status !== "degraded") continue;
    assert.ok(
      series.breaches.length > 0,
      `${series.provider} is degraded but names no breach`
    );
    for (const breach of series.breaches) {
      assert.ok(breach.metric, "breach is missing a metric");
      assert.ok(Number.isFinite(breach.baseline));
      assert.ok(Number.isFinite(breach.current));
      assert.ok(breach.onsetDate, `${breach.metric} breach has no onset date`);
    }
  }
});

test("age is reported as a numeric header for header-matching monitors", async () => {
  const { res } = await get();
  const age = res.headers.get("x-health-age-hours");

  assert.ok(age, "expected X-Health-Age-Hours");
  assert.ok(Number.isFinite(Number(age)), `not numeric: ${age}`);
  assert.ok(Number(age) >= 0);
});

test("provider slugs with dashes resolve to the underscored key", async () => {
  const { body } = await get("?provider=browser-use");
  assert.equal(body.series[0].provider, "BROWSER_USE");
});

test("provider=all aggregates every provider", async () => {
  const { body } = await get("?provider=all");
  assert.ok(body.series.length > 1, "expected more than one series");
});

test("concurrency=10 is a distinct, valid view", async () => {
  const { body } = await get("?provider=notte&concurrency=10");
  assert.equal(body.concurrency, 10);
  assert.equal(body.series[0].provider, "NOTTE");
});

test("invalid parameters are rejected with 400 and never cached", async () => {
  for (const query of ["?concurrency=7", "?provider=bogus", "?benchmark=v0"]) {
    const { res, body } = await get(query);
    assert.equal(res.status, 400, `expected 400 for ${query}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(body.error, `expected an error message for ${query}`);
  }
});

test("a 400 is never mistaken for a health signal", async () => {
  // Monitors alert on non-2xx. A malformed query must not read as `degraded`,
  // or a typo'd monitor URL would look like a live incident.
  const { body } = await get("?concurrency=7");
  assert.equal(body.status, "unknown");
});
