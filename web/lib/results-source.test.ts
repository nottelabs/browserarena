import assert from "node:assert/strict";
import test from "node:test";
import { fetchFromGitHub, GitHubReadError, listFromGitHub, loadHistoricalLeaderboard, PUBLIC_RESULTS_SOURCE } from "./data";

const PRIVATE = { repo: "nottelabs/browserarena-staging-results", branch: "main", token: "read-only" };

test("private results are read through the API with the token and never cached", async (t) => {
  const calls: { url: string; init: RequestInit & { next?: unknown } }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return url.includes("/contents/results/hello-browser?")
      ? Response.json([{ name: "notte-staging", path: "results/hello-browser/notte-staging", type: "dir" }])
      : new Response("{}\n");
  });

  assert.deepEqual(await listFromGitHub("results/hello-browser", PRIVATE), [
    { name: "notte-staging", path: "results/hello-browser/notte-staging", type: "dir" },
  ]);
  assert.equal(await fetchFromGitHub("results/hello-browser/notte-staging/2026-11-09/c1/results.jsonl", PRIVATE), "{}\n");
  assert.deepEqual(calls.map((c) => c.url), [
    "https://api.github.com/repos/nottelabs/browserarena-staging-results/contents/results/hello-browser?ref=main",
    "https://api.github.com/repos/nottelabs/browserarena-staging-results/contents/results/hello-browser/notte-staging/2026-11-09/c1/results.jsonl?ref=main",
  ]);
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer read-only");
    assert.equal(init.cache, "no-store");
    assert.equal(init.next, undefined);
  }
  assert.equal(new Headers(calls[1]!.init.headers).get("accept"), "application/vnd.github.raw+json");
});

test("public results stay anonymous and cached", async (t) => {
  const calls: { url: string; init: RequestInit & { next?: unknown } }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}\n");
  });
  await fetchFromGitHub("results/hello-browser/notte/2026-11-09/c1/results.jsonl");
  assert.equal(calls[0]!.url, `https://raw.githubusercontent.com/${PUBLIC_RESULTS_SOURCE.repo}/${PUBLIC_RESULTS_SOURCE.branch}/results/hello-browser/notte/2026-11-09/c1/results.jsonl`);
  assert.equal(new Headers(calls[0]!.init.headers).get("authorization"), null);
  assert.deepEqual(calls[0]!.init.next, { revalidate: 60 });
});

/** A private repo with notte-staging runs on two days; `fail` maps a path suffix to an HTTP status. */
function fakeRepo(fail: Record<string, number> = {}) {
  const line = (date: string) => JSON.stringify({
    created_at: `${date}T20:00:10.000Z`, id: date, provider: "NOTTE_STAGING", concurrency: 1, success: true,
    session_creation_ms: 300, session_connect_ms: 30, page_goto_ms: 80, session_release_ms: 40,
    warmup: false, cold_start: false, error_stage: null, error_message: null,
  });
  return async (url: string) => {
    const path = new URL(url).pathname.replace("/repos/nottelabs/browserarena-staging-results/contents/", "");
    const status = Object.entries(fail).find(([suffix]) => path.endsWith(suffix))?.[1];
    if (status) return new Response("", { status });
    if (path === "results/hello-browser") return Response.json([{ name: "notte-staging", path, type: "dir" }]);
    if (path === "results/hello-browser/notte-staging") {
      return Response.json(["2026-11-08", "2026-11-09"].map((name) => ({ name, path: `${path}/${name}`, type: "dir" })));
    }
    const day = path.match(/notte-staging\/(\d{4}-\d{2}-\d{2})$/)?.[1];
    if (day) return Response.json([{ name: "c1", path: `${path}/c1`, type: "dir" }]);
    const file = path.match(/(\d{4}-\d{2}-\d{2})\/c1\/results\.jsonl$/)?.[1];
    if (file) return new Response(`${line(file)}\n`);
    return new Response("", { status: 404 });
  };
}

const days = (r: Awaited<ReturnType<typeof loadHistoricalLeaderboard>>) => r.providers.flatMap((p) => p.points.map((pt) => pt.date));

test("strict history fails on a read error instead of dropping that day; the default still skips it", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", fakeRepo({ "2026-11-08/c1/results.jsonl": 500 }));
  assert.deepEqual(days(await loadHistoricalLeaderboard("hello-browser", 1, PRIVATE)), ["2026-11-09"]);
  await assert.rejects(loadHistoricalLeaderboard("hello-browser", 1, PRIVATE, { strict: true }), (e) => e instanceof GitHubReadError && e.status === 500);

  fetchMock.mock.mockImplementation(fakeRepo({ "results/hello-browser/notte-staging": 403 }));
  await assert.rejects(loadHistoricalLeaderboard("hello-browser", 1, PRIVATE, { strict: true }), (e) => e instanceof GitHubReadError && e.status === 403);
});

test("strict history still treats a missing run as missing", async (t) => {
  t.mock.method(globalThis, "fetch", fakeRepo({ "2026-11-08/c1/results.jsonl": 404 }));
  assert.deepEqual(days(await loadHistoricalLeaderboard("hello-browser", 1, PRIVATE, { strict: true })), ["2026-11-09"]);
  // No c10 folder on either day: no series, no error.
  assert.deepEqual(days(await loadHistoricalLeaderboard("hello-browser", 10, PRIVATE, { strict: true })), []);
});
