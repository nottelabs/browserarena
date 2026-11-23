import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  fsResultsStore,
  readResultsIndex,
  remoteResultsStore,
  resultsStoreFor,
  writeResultsIndex,
  type ResultsIndex,
} from "./results-store";

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

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "results-index-"));
}

test("the index lists lifecycle and throughput results and metadata, not logs or screenshots", () => {
  const root = tempDir();
  try {
    const results = path.join(root, "results");
    for (const file of [
      "hello-browser/notte/2026-11-23/_meta.json",
      "hello-browser/notte/2026-11-23/c1/results.jsonl",
      "hello-browser/notte/2026-11-23/results.log",
      "hello-browser/notte/2026-11-23/screenshots/fail.png",
      "browser-throughput/steel/2026-11-23/c1/results.jsonl",
      "captcha/2026-11-23.json",
    ]) {
      fs.mkdirSync(path.dirname(path.join(results, file)), { recursive: true });
      fs.writeFileSync(path.join(results, file), "x");
    }
    const indexFile = path.join(root, "index.json");
    const index = writeResultsIndex(results, indexFile, { repo: "o/r", commit: () => "abc" });
    assert.deepEqual(index, {
      repo: "o/r",
      commit: "abc",
      files: [
        "browser-throughput/steel/2026-11-23/c1/results.jsonl",
        "hello-browser/notte/2026-11-23/_meta.json",
        "hello-browser/notte/2026-11-23/c1/results.jsonl",
      ],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(indexFile, "utf-8")), index);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a build without lifecycle or throughput results writes no index and removes a stale one", () => {
  const root = tempDir();
  try {
    const results = path.join(root, "results");
    fs.mkdirSync(path.join(results, "captcha"), { recursive: true });
    const indexFile = path.join(root, "index.json");
    fs.writeFileSync(indexFile, JSON.stringify(index));
    const commit = () => { throw new Error("no commit needed without results"); };
    assert.equal(writeResultsIndex(results, indexFile, { repo: "o/r", commit }), null);
    assert.equal(fs.existsSync(indexFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an empty index keeps the GitHub fallback instead of an empty remote store", () => {
  const root = tempDir();
  try {
    const indexFile = path.join(root, "index.json");
    fs.writeFileSync(indexFile, JSON.stringify({ ...index, files: [] }));
    assert.equal(readResultsIndex(indexFile), null);
    assert.equal(resultsStoreFor("hello-browser", path.join(root, "results"), indexFile), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("results on disk win over the index; without them the index is used", () => {
  const root = tempDir();
  try {
    const indexFile = path.join(root, "index.json");
    fs.writeFileSync(indexFile, JSON.stringify(index));
    const results = path.join(root, "results");
    assert.equal(resultsStoreFor("hello-browser", results, indexFile)?.kind, "remote");
    fs.mkdirSync(path.join(results, "hello-browser"), { recursive: true });
    assert.equal(resultsStoreFor("hello-browser", results, indexFile)?.kind, "fs");
    assert.equal(resultsStoreFor("hello-browser", results, path.join(root, "missing.json"))?.kind, "fs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
