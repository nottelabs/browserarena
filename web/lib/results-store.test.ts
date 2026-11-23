import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fsResultsStore, remoteResultsStore, type ResultsIndex } from "./results-store";

const index: ResultsIndex = {
  repo: "nottelabs/browserarena",
  commit: "abc123",
  files: [
    "hello-browser/notte/2026-11-22/_meta.json",
    "hello-browser/notte/2026-11-22/c1/results.jsonl",
    "hello-browser/notte/2026-11-23/c1/results.jsonl",
    "hello-browser/steel/2026-11-23/c10/results.jsonl",
  ],
};

function fakeFetch(responses: Record<string, Response | Error>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses[url];
    if (next instanceof Error) throw next;
    return next ?? new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

const fileUrl = (relative: string) => `https://raw.githubusercontent.com/nottelabs/browserarena/abc123/results/${relative}`;

test("remote store lists directories and files from the index", async () => {
  const store = remoteResultsStore(index, fakeFetch({}).impl);
  assert.deepEqual(await store.list("hello-browser"), [
    { name: "notte", isDirectory: true },
    { name: "steel", isDirectory: true },
  ]);
  assert.deepEqual(await store.list("hello-browser/notte/2026-11-22"), [
    { name: "_meta.json", isDirectory: false },
    { name: "c1", isDirectory: true },
  ]);
  assert.deepEqual(await store.list("hello-browser/kernel"), []);
});

test("remote store reads files at the built commit, cached", async () => {
  const file = "hello-browser/notte/2026-11-23/c1/results.jsonl";
  const { impl, calls } = fakeFetch({ [fileUrl(file)]: new Response('{"provider":"NOTTE"}\n') });
  const store = remoteResultsStore(index, impl);
  assert.equal(await store.read(file), '{"provider":"NOTTE"}\n');
  assert.equal(calls[0]!.url, fileUrl(file));
  assert.equal(calls[0]!.init?.cache, "force-cache");
});

test("remote store returns null without a request for files not in the index", async () => {
  const { impl, calls } = fakeFetch({});
  const store = remoteResultsStore(index, impl);
  assert.equal(await store.read("hello-browser/notte/2026-11-21/c1/results.jsonl"), null);
  assert.equal(calls.length, 0);
});

test("remote store retries server errors and fails after three attempts", async () => {
  const file = "hello-browser/steel/2026-11-23/c10/results.jsonl";
  let attempts = 0;
  const impl = (async () => {
    attempts++;
    return attempts < 3 ? new Response("busy", { status: 503 }) : new Response("ok");
  }) as unknown as typeof fetch;
  assert.equal(await remoteResultsStore(index, impl).read(file), "ok");

  const failing = fakeFetch({ [fileUrl(file)]: new Error("network down") });
  await assert.rejects(remoteResultsStore(index, failing.impl).read(file), /network down/);
  assert.equal(failing.calls.length, 3);
});

test("remote store does not retry a missing file the index listed", async () => {
  const file = "hello-browser/steel/2026-11-23/c10/results.jsonl";
  const { impl, calls } = fakeFetch({ [fileUrl(file)]: new Response("gone", { status: 404 }) });
  await assert.rejects(remoteResultsStore(index, impl).read(file), /404/);
  assert.equal(calls.length, 1);
});

test("fs store reads and lists the results directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "results-store-"));
  try {
    fs.mkdirSync(path.join(root, "hello-browser/notte/2026-11-23/c1"), { recursive: true });
    fs.writeFileSync(path.join(root, "hello-browser/notte/2026-11-23/c1/results.jsonl"), "x\n");
    const store = fsResultsStore(root);
    assert.deepEqual(await store.list("hello-browser/notte/2026-11-23"), [{ name: "c1", isDirectory: true }]);
    assert.equal(await store.read("hello-browser/notte/2026-11-23/c1/results.jsonl"), "x\n");
    assert.equal(await store.read("hello-browser/notte/2026-11-22/c1/results.jsonl"), null);
    assert.deepEqual(await store.list("hello-browser/kernel"), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
