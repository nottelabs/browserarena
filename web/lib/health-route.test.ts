/**
 * Integration tests for the /api/health route handler.
 *
 * These drive the real exported `GET` against the real committed results —
 * route -> regression detector -> data loader -> filesystem — with no mocks and
 * no dev server. They cover the contract an external uptime monitor depends on:
 * the HTTP status code, the headers, and the parameter validation.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/api/health/route";

const BASE = "http://localhost/api/health";

async function get(query = "") {
  const res = await GET(new Request(`${BASE}${query}`));
  return { res, body: await res.json() };
}

test("defaults to Notte and returns 503 while the release regression is open", async () => {
  const { res, body } = await get();

  assert.equal(res.status, 503);
  assert.equal(res.headers.get("x-health-status"), "degraded");
  assert.equal(res.headers.get("retry-after"), "3600");
  assert.equal(body.status, "degraded");
  assert.equal(body.series[0].provider, "NOTTE");

  const release = body.series[0].breaches.find(
    (b: { metric: string }) => b.metric === "release"
  );
  assert.ok(release, "expected the release breach to be reported");
  assert.equal(release.onsetDate, "2026-09-05");
  assert.ok(release.ratio > 10);
});

test("a healthy provider returns 200 and is CDN-cacheable", async () => {
  const { res, body } = await get("?provider=steel");

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-health-status"), "ok");
  assert.equal(
    res.headers.get("cache-control"),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  assert.equal(body.status, "ok");
});

test("degraded responses are briefly cached, never no-store", async () => {
  // A regression stays open for days. Sending no-store would make every uptime
  // check re-parse the full result history for the whole incident.
  const { res } = await get();
  const cacheControl = res.headers.get("cache-control") ?? "";

  assert.ok(!cacheControl.includes("no-store"), `got: ${cacheControl}`);
  assert.match(cacheControl, /s-maxage=60/);
});

test("age is reported as a numeric header for header-matching monitors", async () => {
  const { res } = await get();
  const age = res.headers.get("x-health-age-hours");

  assert.ok(age, "expected X-Health-Age-Hours");
  assert.ok(Number.isFinite(Number(age)), `not numeric: ${age}`);
  assert.ok(Number(age) >= 0);
});

test("provider slugs with dashes resolve to the underscored key", async () => {
  const { res, body } = await get("?provider=browser-use");

  assert.equal(res.status, 200);
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
  for (const query of [
    "?concurrency=7",
    "?provider=bogus",
    "?benchmark=v0",
  ]) {
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
