import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { proxySuiteOutput } from "./output.js";
import { runProxyGetSuite } from "./run.js";
import { DEFAULT_PROXY_PRICING } from "./pricing.js";
import { PAYLOAD_BYTES, PAYLOAD_SHA256 } from "./payload.js";
import type { ProviderClient } from "../../types.js";

test("overnight resume finds the original file and creates only the missing attempts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-midnight-"));
  let creates = 0;
  const client: ProviderClient = { name: "STEEL", proxyCountries: ["FR"], computeCost: () => 0,
    create: async () => { creates++; throw new Error("Recorded launch failure"); }, release: async () => {} };
  const options = { runId: "overnight-suite", runs: 3, countries: ["FR"] as const,
    url: "https://fixture.example/payload", bootstrapUrl: "https://fixture.example/bootstrap",
    countryUrl: "https://fixture.example/country", timeoutMs: 30000, expectedBytes: PAYLOAD_BYTES, expectedSha256: PAYLOAD_SHA256 };
  try {
    const original = proxySuiteOutput("steel", options.runId, "2026-10-12", root);
    await runProxyGetSuite([{ client, out: original }], { ...options, countries: [...options.countries] }, DEFAULT_PROXY_PRICING);
    const resumed = proxySuiteOutput("steel", options.runId, "2026-10-13", root);
    assert.equal(resumed, original);
    await runProxyGetSuite([{ client, out: resumed }], { ...options, countries: [...options.countries], runs: 10 }, DEFAULT_PROXY_PRICING);
    assert.equal(creates, 10, "the three saved failures must count toward ten");
    assert.equal(fs.readFileSync(original, "utf8").trim().split("\n").length, 10);
    assert.equal(fs.existsSync(path.join(root, "proxy-get/steel/2026-10-13")), false);
    assert.equal(proxySuiteOutput("steel", "new-suite", "2026-10-13", root), path.join(root, "proxy-get/steel/2026-10-13/results.jsonl"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("already split run IDs stop recovery instead of adding more paid attempts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-split-"));
  try {
    for (const day of ["2026-10-12", "2026-10-13"]) {
      const dir = path.join(root, "proxy-get/steel", day);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "results.jsonl"), JSON.stringify({ run_id: "split" }) + "\n");
    }
    assert.throws(() => proxySuiteOutput("steel", "split", "2026-10-14", root), /split across multiple files/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("damaged old rows warn without blocking unrelated new suites or changing history", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-damaged-"));
  const old = path.join(root, "proxy-get/steel/2026-10-12/results.jsonl");
  const content = '{"run_id":"old-suite"}\nnull\n[]\n42\n{"run_id":"old-suite","status":\n{"run_id":"bad\\q"}\n';
  const warnings: string[] = [];
  const originalError = console.error;
  let creates = 0;
  const client: ProviderClient = { name: "STEEL", proxyCountries: ["FR"], computeCost: () => 0,
    create: async () => { creates++; throw new Error("Recorded launch failure"); }, release: async () => {} };
  try {
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, content);
    fs.writeFileSync(path.join(path.dirname(old), "_meta.json"), JSON.stringify({ run_id: "old-suite" }));
    console.error = (...args) => { warnings.push(args.join(" ")); };
    const out = proxySuiteOutput("steel", "new-suite", "2026-10-13", root);
    assert.equal(out, path.join(root, "proxy-get/steel/2026-10-13/results.jsonl"));
    await runProxyGetSuite([{ client, out }], { runId: "new-suite", runs: 1, countries: ["FR"],
      url: "https://fixture.example/payload", bootstrapUrl: "https://fixture.example/bootstrap",
      countryUrl: "https://fixture.example/country", timeoutMs: 30000, expectedBytes: PAYLOAD_BYTES,
      expectedSha256: PAYLOAD_SHA256 }, DEFAULT_PROXY_PRICING);
    assert.equal(creates, 1);
    assert.equal(fs.readFileSync(old, "utf8"), content);
    assert.ok(warnings.some(warning => warning.includes(`${old}:2`) && warning.includes("preserved unchanged")));
    assert.ok(warnings.every(warning => !warning.includes('bad\\q')));
    assert.throws(() => proxySuiteOutput("steel", "old-suite", "2026-10-13", root), /Damaged proxy history.*reconcile/);
  } finally {
    console.error = originalError;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("damage before or after a matching row requires explicit recovery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-damaged-match-"));
  const file = path.join(root, "proxy-get/steel/2026-10-12/results.jsonl");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const content of ['null\n{"run_id":"broken"}\n', '{"run_id":"broken"}\n{"unfinished":']) {
      fs.writeFileSync(file, content);
      assert.throws(() => proxySuiteOutput("steel", "broken", "2026-10-13", root), /Damaged proxy history/);
      assert.equal(fs.readFileSync(file, "utf8"), content);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a damaged first attempt is identified by surviving run ID or metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-damaged-first-"));
  const dir = path.join(root, "proxy-get/steel/2026-10-12");
  const file = path.join(dir, "results.jsonl");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '{"run_id":"broken","status":');
    assert.throws(() => proxySuiteOutput("steel", "broken", "2026-10-13", root), /Damaged proxy history/);
    fs.writeFileSync(file, '{"benchmark":');
    fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify({ run_id: "broken" }));
    assert.throws(() => proxySuiteOutput("steel", "broken", "2026-10-13", root), /Damaged proxy history/);
    assert.equal(fs.readFileSync(file, "utf8"), '{"benchmark":');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a damaged destination stops all provider jobs before any paid attempts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-damaged-destination-"));
  const file = path.join(root, "results.jsonl");
  let creates = 0;
  const client: ProviderClient = { name: "STEEL", proxyCountries: ["FR"], computeCost: () => 0,
    create: async () => { creates++; throw new Error("Must not create"); }, release: async () => {} };
  try {
    fs.writeFileSync(file, '{"run_id":"old",');
    for (const runId of [undefined, "new-suite"]) {
      await assert.rejects(() => runProxyGetSuite([{ client, out: path.join(root, "new.jsonl") }, { client, out: file }], {
        runId, runs: 1, countries: ["FR"], url: "https://fixture.example/payload", bootstrapUrl: "https://fixture.example/bootstrap",
        countryUrl: "https://fixture.example/country", timeoutMs: 30000, expectedBytes: PAYLOAD_BYTES,
        expectedSha256: PAYLOAD_SHA256 }, DEFAULT_PROXY_PRICING), /Damaged proxy history.*:1/);
    }
    assert.equal(creates, 0);
    assert.equal(fs.existsSync(path.join(root, "new.jsonl")), false);
    assert.equal(fs.readFileSync(file, "utf8"), '{"run_id":"old",');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI preflight ignores damaged history without changing files or creating sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-damaged-preflight-"));
  const dir = path.join(root, "results/proxy-get/lightpanda/2026-10-12");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const content = '{"run_id":"broken",';
    fs.writeFileSync(path.join(dir, "results.jsonl"), content);
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url)),
      fileURLToPath(new URL("../../cli.ts", import.meta.url)), "--benchmark=proxy-get", "--provider=lightpanda", "--runs=1",
      "--run-id=broken", "--preflight"], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /PREFLIGHT.*no sessions created/);
    assert.doesNotMatch(run.stderr, /PROXY_GET/);
    assert.deepEqual(fs.readdirSync(dir), ["results.jsonl"]);
    assert.equal(fs.readFileSync(path.join(dir, "results.jsonl"), "utf8"), content);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI preserves damaged custom output and its metadata before rejecting an append", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-damaged-custom-"));
  const file = path.join(root, "results.jsonl");
  const meta = path.join(root, "_meta.json");
  try {
    fs.writeFileSync(file, '{"run_id":"old",');
    fs.writeFileSync(meta, JSON.stringify({ run_id: "old" }));
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url)),
      fileURLToPath(new URL("../../cli.ts", import.meta.url)), "--benchmark=proxy-get", "--provider=lightpanda", "--runs=1",
      "--run-id=new-suite", `--out=${file}`], { cwd: root, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Damaged proxy history.*reconcile/);
    assert.equal(fs.readFileSync(file, "utf8"), '{"run_id":"old",');
    assert.equal(fs.readFileSync(meta, "utf8"), JSON.stringify({ run_id: "old" }));
    assert.deepEqual(fs.readdirSync(root).sort(), ["_meta.json", "results.jsonl"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
