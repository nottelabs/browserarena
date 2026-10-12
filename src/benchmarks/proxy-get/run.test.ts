import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { chromium, type BrowserContext } from "playwright-core";
import type { ProviderClient, SessionOptions } from "../../types.js";
import { SessionCreationError } from "../../types.js";
import { runProxyGet, runProxyGetSuite, type ProxyGetOptions } from "./run.js";
import { PROXY_COUNTRIES } from "./schema.js";
import { PAYLOAD, PAYLOAD_SHA256 } from "./payload.js";
import { DEFAULT_PROXY_PRICING } from "./pricing.js";
import { validateProxyGetUrls } from "./validate.js";

test("secure-context URL validation rejects non-loopback HTTP before creating sessions", async () => {
  for (const origin of ["https://target.example", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.doesNotThrow(() => validateProxyGetUrls(`${origin}/payload`, `${origin}/bootstrap`, "https://api.country.is/"));
  }
  for (const origin of ["http://target.example", "http://192.168.0.10", "http://localhost.example"]) {
    assert.throws(() => validateProxyGetUrls(`${origin}/payload`, `${origin}/bootstrap`, "https://api.country.is/"), /require HTTPS/);
  }
  assert.throws(() => validateProxyGetUrls("https://a.example/payload", "https://b.example/bootstrap", "https://api.country.is/"), /share.*origin/);
  let creates = 0;
  const provider: ProviderClient = { name: "TILION", proxyCountries: ["US"], computeCost: () => 0,
    create: async () => { creates++; throw new Error("must not create"); }, release: async () => {} };
  const options = { url: "http://target.example/payload", bootstrapUrl: "http://target.example/bootstrap", countryUrl: "https://api.country.is/" } as ProxyGetOptions;
  await assert.rejects(() => runProxyGet(provider, "US", options, null), /require HTTPS/);
  await assert.rejects(() => runProxyGetSuite([{ client: provider, out: "unused.jsonl" }], { ...options, runs: 10, countries: ["US"] }, {}), /require HTTPS/);
  assert.equal(creates, 0);
});

test("known Tilion sessions with failed create cleanup retain IDs and unknown cost for audit", async () => {
  const provider: ProviderClient = { name: "TILION", proxyCountries: ["US"], computeCost: () => 0,
    create: async () => { throw new SessionCreationError("Wrong region", "known-session", "Release failed", null); },
    release: async () => { throw new Error("adapter already attempted release"); } };
  const options = { url: "https://target.example/payload", bootstrapUrl: "https://target.example/bootstrap", countryUrl: "https://api.country.is/" } as ProxyGetOptions;
  const record = await runProxyGet(provider, "US", options, DEFAULT_PROXY_PRICING.TILION);
  assert.equal(record.session_id, "known-session");
  assert.equal(record.error_stage, "session_create");
  assert.equal(record.error_message, "Wrong region");
  assert.equal(record.cleanup_error, "Release failed");
  assert.equal(record.session_wall_ms, null);
  assert.equal(record.cost_usd, null);
});

test("unsupported proxies never create an unproxied session", async () => {
  let created = false;
  const provider: ProviderClient = { name: "LIGHTPANDA", computeCost: () => 0,
    create: async () => { created = true; throw new Error("must not create"); }, release: async () => {} };
  const result = await runProxyGet(provider, "FR", {} as ProxyGetOptions, null);
  assert.equal(result.status, "unsupported");
  assert.equal(created, false);
  assert.equal(result.cost_usd, null);
});

test("the suite records exactly ten attempts per supported country and one unsupported marker", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-suite-"));
  const out = path.join(dir, "results.jsonl");
  let creates = 0;
  const provider: ProviderClient = { name: "STEEL", proxyCountries: ["FR"], computeCost: () => 0,
    create: async () => { creates++; throw new Error("Creation failed"); }, release: async () => {} };
  try {
    await runProxyGetSuite([{ client: provider, out }], { url: "https://fixture.example/payload", bootstrapUrl: "https://fixture.example/bootstrap",
      countryUrl: "https://fixture.example/country", timeoutMs: 30000, expectedBytes: PAYLOAD.length, expectedSha256: PAYLOAD_SHA256,
      runs: 10, countries: ["FR", "US"] }, DEFAULT_PROXY_PRICING);
    const rows = fs.readFileSync(out, "utf-8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(creates, 10);
    assert.equal(rows.filter(r => r.country === "FR" && r.status === "failed").length, 10);
    assert.equal(rows.filter(r => r.country === "US" && r.status === "unsupported").length, 1);
    assert.equal(new Set(rows.map(r => r.run_id)).size, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("daily batches accumulate to fifty, retain failures, and resume without duplicate attempts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-daily-"));
  const out = path.join(dir, "results.jsonl");
  let creates = 0;
  const provider: ProviderClient = { name: "STEEL", proxyCountries: ["FR"], computeCost: () => 0,
    create: async () => { creates++; throw new Error("Creation failed"); }, release: async () => {} };
  const options = { url: "https://fixture.example/payload", bootstrapUrl: "https://fixture.example/bootstrap",
    countryUrl: "https://fixture.example/country", timeoutMs: 30000, expectedBytes: PAYLOAD.length,
    expectedSha256: PAYLOAD_SHA256, countries: ["FR", "US"] as const, runId: "daily-proxy-2026-10-12" };
  try {
    for (const runs of [10, 20, 20, 30, 40, 50, 50]) {
      await runProxyGetSuite([{ client: provider, out }], { ...options, countries: [...options.countries], runs }, DEFAULT_PROXY_PRICING);
    }
    const rows = fs.readFileSync(out, "utf-8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(creates, 50);
    assert.equal(rows.filter(r => r.country === "FR" && r.status === "failed").length, 50);
    assert.equal(rows.filter(r => r.status === "unsupported").length, 1);
    assert.equal(new Set(rows.map(r => r.run_id)).size, 1);
    await assert.rejects(() => runProxyGetSuite([{ client: provider, out }], {
      ...options, countries: [...options.countries], runs: 60, timeoutMs: 20000,
    }, DEFAULT_PROXY_PRICING), /workload changed/);
    await assert.rejects(() => runProxyGetSuite([{ client: { ...provider, proxyCountries: ["FR", "US"] }, out }], {
      ...options, countries: [...options.countries], runs: 50,
    }, DEFAULT_PROXY_PRICING), /proxy support changed/);
    assert.equal(creates, 50);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("proxy GET browser integration", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-get-test-"));
  let context: BrowserContext | undefined;
  for (const options of [{}, { channel: "chrome" }]) {
    try {
      context = await chromium.launchPersistentContext(dir, { ...options, args: ["--remote-debugging-port=0"] });
      break;
    } catch (error) {
      if (!/Executable doesn't exist|is not found|ENOENT/i.test(String(error))) throw error;
    }
  }
  if (!context) { fs.rmSync(dir, { recursive: true, force: true }); t.skip("No Chromium installed"); return; }
  const port = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf-8").split("\n")[0];
  const cdpUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  let country = "FR";
  let countryFails = false;
  let payloadRequests = 0;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url!, "http://local").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (pathname === "/geo") {
      res.setHeader("Content-Type", "application/json");
      if (countryFails) res.statusCode = 429;
      res.end(JSON.stringify({ country })); return;
    }
    if (pathname === "/bootstrap") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><link rel="icon" href="data:,">'); return; }
    payloadRequests++;
    if (pathname === "/redirect") { res.writeHead(302, { Location: "/payload" }); res.end(); return; }
    const body = pathname === "/corrupt" ? Buffer.alloc(PAYLOAD.length) : pathname === "/short" ? PAYLOAD.subarray(0, 100) : PAYLOAD;
    res.writeHead(pathname === "/error" ? 403 : 200, { "Content-Type": "application/octet-stream" });
    res.write(body.subarray(0, Math.min(128, body.length)));
    const timer = setTimeout(() => res.end(body.subarray(128)), pathname === "/stall" ? 5000 : 150);
    res.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const options: ProxyGetOptions = { url: `${origin}/payload`, bootstrapUrl: `${origin}/bootstrap`,
    countryUrl: `${origin}/geo`, expectedBytes: PAYLOAD.length, expectedSha256: PAYLOAD_SHA256, timeoutMs: 3000 };
  let releases = 0;
  let cleanupFails = false;
  let createFails = false;
  const provider: ProviderClient = { name: "STEEL", proxyCountries: PROXY_COUNTRIES, computeCost: () => 0,
    create: async (opts?: SessionOptions) => {
      assert.equal(opts?.proxyCountry, "FR");
      if (createFails) throw new Error("Creation failed");
      await new Promise(resolve => setTimeout(resolve, 250));
      return { id: "test-session", cdpUrl };
    },
    release: async () => { releases++; await new Promise(resolve => setTimeout(resolve, 250));
      if (cleanupFails) throw new Error("Release failed"); },
  };
  try {
    await t.test("reads the delayed final bytes, excludes setup, and bills the full session", async () => {
      const record = await runProxyGet(provider, "FR", options, DEFAULT_PROXY_PRICING.STEEL);
      assert.equal(record.error_message, null);
      assert.equal(record.status, "success");
      assert.equal(record.bytes_received, PAYLOAD.length);
      assert.ok(record.get_ms! >= 100 && record.get_ms! < 450, JSON.stringify(record));
      assert.ok(record.first_byte_ms! < record.get_ms!);
      assert.ok(record.session_wall_ms! > record.get_ms! + 450);
      assert.equal(record.browser_cost_usd, 0.1 / 60);
      assert.ok(record.proxy_cost_usd! > 0);
      assert.ok(record.transfer_bytes >= PAYLOAD.length);
      assert.ok(record.diagnostics!.network.some(n => n.phase === "get" && n.http_status === 200));
      assert.ok(record.diagnostics!.phase_ms.get >= record.get_ms!);
    });
    await t.test("country mismatch prevents the measured GET and still releases", async () => {
      country = "US";
      const before = payloadRequests;
      const record = await runProxyGet(provider, "FR", options, DEFAULT_PROXY_PRICING.STEEL);
      assert.equal(record.error_stage, "country_verification");
      assert.equal(record.observed_country, "US");
      assert.equal(record.get_ms, null);
      assert.equal(payloadRequests, before);
      assert.ok(record.browser_cost_usd! > 0);
      country = "FR";
    });
    await t.test("country-check HTTP failures retain network evidence and never issue a measured GET", async () => {
      countryFails = true;
      const before = payloadRequests;
      const record = await runProxyGet(provider, "FR", options, DEFAULT_PROXY_PRICING.STEEL);
      countryFails = false;
      assert.equal(record.status, "failed");
      assert.equal(record.error_stage, "country_verification");
      assert.equal(payloadRequests, before);
      assert.ok(record.diagnostics!.network.some(n => n.phase === "country_verification" && n.http_status === 429));
      assert.ok(record.diagnostics!.phase_ms.country_verification > 0);
    });
    for (const endpoint of ["corrupt", "short", "error", "redirect"]) {
      await t.test(`rejects ${endpoint} responses`, async () => {
        const record = await runProxyGet(provider, "FR", { ...options, url: `${origin}/${endpoint}` }, DEFAULT_PROXY_PRICING.STEEL);
        assert.equal(record.status, "failed");
        assert.ok(record.error_message);
        assert.ok(record.session_release_ms !== null);
      });
    }
    await t.test("a stalled body times out and preserves partial traffic", async () => {
      const record = await runProxyGet(provider, "FR", { ...options, url: `${origin}/stall`, timeoutMs: 1000 }, DEFAULT_PROXY_PRICING.STEEL);
      assert.equal(record.status, "failed");
      assert.match(record.error_message!, /timed out/);
      assert.equal(record.bytes_received, 128);
      assert.equal(record.get_ms, null);
      assert.ok(record.proxy_cost_usd! > 0);
      const network = record.diagnostics!.network.find(n => n.phase === "get")!;
      assert.equal(network.http_status, 200);
      assert.equal(network.bytes_received, 128);
      assert.ok(record.diagnostics!.phase_ms.get >= 1000);
    });
    await t.test("cleanup failure keeps valid speed and makes cost unknown", async () => {
      cleanupFails = true;
      const record = await runProxyGet(provider, "FR", options, DEFAULT_PROXY_PRICING.STEEL);
      assert.equal(record.status, "success");
      assert.match(record.cleanup_error!, /Release failed/);
      assert.equal(record.cost_usd, null);
      cleanupFails = false;
    });
    await t.test("provider traffic meters supersede observed bytes", async () => {
      provider.getProxyBytes = async () => 2_000_000;
      const record = await runProxyGet(provider, "FR", options, DEFAULT_PROXY_PRICING.STEEL);
      assert.equal(record.transfer_bytes_source, "provider");
      assert.equal(record.proxy_cost_usd, 0.02);
    });
    await t.test("creation failure is recorded without a fake zero cost or release", async () => {
      createFails = true;
      const before = releases;
      const record = await runProxyGet(provider, "FR", options, DEFAULT_PROXY_PRICING.STEEL);
      assert.equal(record.status, "failed");
      assert.equal(record.error_stage, "session_create");
      assert.equal(record.cost_usd, null);
      assert.equal(releases, before);
    });
    assert.ok(releases >= 9);
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
