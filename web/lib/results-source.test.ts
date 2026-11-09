import assert from "node:assert/strict";
import test from "node:test";
import { fetchFromGitHub, listFromGitHub, PUBLIC_RESULTS_SOURCE } from "./data";

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
