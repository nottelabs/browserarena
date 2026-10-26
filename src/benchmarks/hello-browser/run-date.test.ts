import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { BrowserThroughputRecord } from "../browser-throughput/types.js";

// Run the production CLI and adapter. Only the clock and AWS metadata endpoint
// are replaced; a local HTTP server rejects creates before any browser exists.
async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-date-cli-"));
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"error":"fixture session rejection"}');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const preload = path.join(root, "clock.mjs");
  fs.writeFileSync(preload, `
const RealDate = Date;
const instant = RealDate.parse(process.env.TEST_NOW);
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(${JSON.stringify(baseUrl + "/")})) return realFetch(input, init);
  if (url.startsWith("http://169.254.169.254/")) return new Response("", { status: 404 });
  throw new Error("Unexpected network request in CLI date test");
};
`);
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  let run = 0;
  const invoke = async (now: string, date?: string) => {
    const cwd = path.join(root, `run-${++run}`);
    fs.mkdirSync(cwd);
    const args = ["--import", import.meta.resolve("tsx"), "--import", preload,
      fileURLToPath(new URL("../../cli.ts", import.meta.url)),
      "--benchmark=browser-throughput", "--provider=notte", "--runs=1", "--concurrency=1", "--loops=2", "--articles=fixed"];
    if (date !== undefined) args.push(`--run-date=${date}`);
    const result = await new Promise<{ status: number; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, args, {
        cwd, timeout: 15_000,
        env: { ...process.env, TEST_NOW: now, NOTTE_API_KEY: "test-only", NOTTE_API_URL: baseUrl, OUTPUT: "", RATE: "" },
      }, (error, stdout, stderr) => resolve({ status: error ? Number(error.code) || 1 : 0, stdout, stderr }));
    });
    return { ...result, cwd };
  };
  const rows = (cwd: string, date: string): BrowserThroughputRecord[] => fs.readFileSync(
    path.join(cwd, "results/browser-throughput/notte", date, "c1/results.jsonl"), "utf8"
  ).trim().split("\n").map(line => JSON.parse(line));
  return { invoke, rows, requests: () => requests };
}

test("production CLI rejects invalid and noncanonical run dates before creating results", async t => {
  const f = await fixture(t);
  for (const date of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-01-00", "2026-1-01", "../2026-10-25", "2026-10-25T00:00:00Z"]) {
    const result = await f.invoke("2026-10-26T00:00:01Z", date);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /--run-date must be a valid UTC date/);
    assert.equal(fs.existsSync(path.join(result.cwd, "results")), false);
  }
  assert.equal(f.requests(), 0);
});

test("production CLI accepts valid Gregorian leap days", async t => {
  const f = await fixture(t);
  for (const date of ["2024-02-29", "2000-02-29"]) {
    const result = await f.invoke("2026-10-26T00:00:01Z", date);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.rows(result.cwd, date).length, 4);
    const meta = JSON.parse(fs.readFileSync(path.join(result.cwd, "results/browser-throughput/notte", date, "_meta.json"), "utf8"));
    assert.equal(meta.started_at, "2026-10-26T00:00:01.000Z");
  }
});

test("production CLI keeps explicit output date and article assignments across UTC midnight", async t => {
  const f = await fixture(t);
  const date = "2026-10-25";
  const before = await f.invoke("2026-10-25T23:59:59Z", date);
  const after = await f.invoke("2026-10-26T00:00:01Z", date);
  assert.equal(before.status, 0, before.stderr);
  assert.equal(after.status, 0, after.stderr);
  const left = f.rows(before.cwd, date);
  const right = f.rows(after.cwd, date);
  assert.equal(left.length, 4);
  assert.equal(right.length, 4);
  assert.equal(left[0].created_at, "2026-10-25T23:59:59.000Z");
  assert.equal(right[0].created_at, "2026-10-26T00:00:01.000Z");
  assert.deepEqual(left.map(row => row.article_urls), right.map(row => row.article_urls));
  assert.deepEqual(right[0].article_urls, [
    "https://en.wikipedia.org/wiki/Computer", "https://en.wikipedia.org/wiki/Python_(programming_language)",
  ]);
  assert.deepEqual(fs.readdirSync(path.join(after.cwd, "results/browser-throughput/notte")), [date]);
});

test("production CLI defaults the output date and article rotation to the current UTC day", async t => {
  const f = await fixture(t);
  const result = await f.invoke("2026-10-26T00:00:01Z");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.rows(result.cwd, "2026-10-26")[0].article_urls, [
    "https://en.wikipedia.org/wiki/Python_(programming_language)", "https://en.wikipedia.org/wiki/Linux",
  ]);
});
