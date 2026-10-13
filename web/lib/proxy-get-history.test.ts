import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProxyGet, type ProxyGetRecord } from "./proxy-get";
import { loadProxyGetHistory, summarizeProxyGetHistory } from "./proxy-get-history";
import { proxyHistoryChartData, proxyRollingAverage } from "./proxy-rolling-average";
import { proxyRunCountLabel } from "./proxy-daily-progress";
import { GET } from "../app/api/proxy-get/route";

function entry(date: string, overrides: Partial<ProxyGetRecord> = {}): ProxyGetRecord {
  return { benchmark: "proxy-get", version: 1, provider: "STEEL", country: "US", run_id: `suite-${date}`,
    created_at: `${date}T10:00:00Z`, url: "https://target.example/payload", bootstrap_url: "https://target.example/bootstrap",
    country_verification_url: "https://api.country.is", expected_bytes: 1_048_576, expected_sha256: "a".repeat(64), timeout_ms: 30000,
    connection_mode: "warm-origin-fresh-session", proxy_type: "residential", browser_region: "us-east-1",
    status: "success", get_ms: 100, first_byte_ms: 25, cost_usd: 0.01, transfer_bytes_source: "provider",
    bytes_received: 1_048_576, ...overrides } as ProxyGetRecord;
}

test("daily history and selected violin summaries use exactly the same attempts", () => {
  const rows = [entry("2026-10-07", { get_ms: 200 }), entry("2026-10-07", { get_ms: 600 }), entry("2026-10-08", { get_ms: 900 })];
  const history = summarizeProxyGetHistory(rows, "US", "2026-10-07");
  assert.deepEqual(history.dates, ["2026-10-07", "2026-10-08"]);
  assert.equal(history.selectedDate, "2026-10-07");
  assert.equal(history.selected.providers[0].medianGetMs, 400);
  assert.equal(history.selected.providers[0].samples.length, 2);
  assert.equal(history.days[0].providers[0].medianGetMs, 400);
  assert.equal(history.days[1].providers[0].medianGetMs, 900);
  assert.equal(summarizeProxyGetHistory(rows, "US").selectedDate, "2026-10-08");
  assert.equal(summarizeProxyGetHistory(rows, "US", "not-a-date").selectedDate, "2026-10-08");
});

test("temporary and permanent target days both reach the chart without pooling attempts or medians", () => {
  const rows = [
    ...Array.from({ length: 50 }, () => entry("2026-10-12", { run_id: "premerge-50-2026-10-12",
      url: "https://temporary.trycloudflare.com/api/proxy-get/payload", bootstrap_url: "https://temporary.trycloudflare.com/api/proxy-get/bootstrap", get_ms: 1000 })),
    ...Array.from({ length: 20 }, () => entry("2026-10-13", { run_id: "daily-proxy-2026-10-13",
      url: "https://www.browserarena.ai/api/proxy-get/payload", bootstrap_url: "https://www.browserarena.ai/api/proxy-get/bootstrap", get_ms: 2000 })),
  ];
  const history = summarizeProxyGetHistory(rows, "US");
  assert.deepEqual(history.days.map(d => d.providers[0].attempts), [50, 20]);
  assert.deepEqual(history.workloadChangeDates, ["2026-10-13"]);
  assert.equal(history.overview.providers[0].attempts, 20);
  const chart = proxyHistoryChartData(history.days, "medianGetMs", 7);
  assert.equal(chart.series.length, 2);
  assert.deepEqual(chart.series.map(line => chart.data.map(d => d[line.dataKey])), [[1000, null], [null, 2000]]);
});

test("daily run counts expose the unchanged fifty-attempt target as batches accumulate", () => {
  for (const count of [10, 20, 30, 40, 50]) {
    const rows = Array.from({ length: count }, () => entry("2026-10-13", { run_id: "daily-proxy-2026-10-13" }));
    const daily = summarizeProxyGetHistory(rows, "US").overview.providers[0];
    assert.equal(proxyRunCountLabel(daily), `${count}/50`);
  }
  const manual = summarizeProxyGetHistory([entry("2026-10-12")], "US").overview.providers[0];
  assert.equal(proxyRunCountLabel(manual), "1", "manual suites do not claim a daily target");
});

test("scheduled progress survives a suite crossing UTC midnight", () => {
  const rows = Array.from({ length: 30 }, (_, i) => entry(i < 20 ? "2026-10-13" : "2026-10-14", {
    run_id: "daily-proxy-2026-10-13",
    created_at: i < 20 ? "2026-10-13T23:59:00Z" : "2026-10-14T00:01:00Z",
  }));
  const history = summarizeProxyGetHistory(rows, "US");
  assert.deepEqual(history.dates, ["2026-10-14"]);
  const provider = history.overview.providers[0];
  assert.equal(provider.runDate, "2026-10-14");
  assert.equal(provider.attempts, 30);
  assert.equal(proxyRunCountLabel(provider), "30/50");
});

test("latest same-day suite replaces earlier success and preserves failed costs", () => {
  const rows = [entry("2026-10-08"), entry("2026-10-08", { run_id: "rerun", created_at: "2026-10-08T11:00:00Z", status: "failed", get_ms: null })];
  const result = summarizeProxyGetHistory(rows, "US");
  assert.equal(result.days[0].providers[0].medianGetMs, null);
  assert.equal(result.days[0].providers[0].attempts, 1);
  assert.equal(result.selected.providers[0].successes, 0);
  assert.equal(result.selected.providers[0].totalCostUsd, 0.01);
  assert.equal(result.selected.providers[0].costPerSuccessUsd, null);
});

test("five stored daily batches feed all fifty attempts into the API, distribution, and history", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-daily-storage-"));
  const previous = process.env.RESULTS_DIR;
  process.env.RESULTS_DIR = base;
  try {
    const dir = path.join(base, "proxy-get", "steel", "2026-10-12");
    fs.mkdirSync(dir, { recursive: true });
    for (let batch = 0; batch < 5; batch++) {
      const rows = Array.from({ length: 10 }, (_, i) => entry("2026-10-12", {
        run_id: "daily-proxy-2026-10-12", created_at: `2026-10-12T${String(1 + batch * 4).padStart(2, "0")}:00:${String(i).padStart(2, "0")}Z`,
        status: i === 0 ? "failed" : "success", get_ms: i === 0 ? null : 100 + batch * 100,
      }));
      fs.appendFileSync(path.join(dir, "results.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    }
    const history = await loadProxyGetHistory("US", "2026-10-12");
    assert.equal(history.days.length, 1);
    assert.equal(history.days[0].providers[0].attempts, 50);
    assert.equal(history.days[0].providers[0].successes, 45);
    assert.equal(history.overview.providers[0].samples.length, 50);
    assert.equal(history.overview.providers[0].medianGetMs, 300);
    const response = await GET(new Request("https://example.test/api/proxy-get?country=US&date=2026-10-12&view=overview"));
    const overview = await response.json();
    assert.equal(response.status, 200);
    assert.equal(overview.providers[0].attempts, 50);
    assert.equal(overview.providers[0].successes, 45);
    assert.ok(Math.abs(overview.providers[0].totalCostUsd - 0.5) < 1e-9);
  } finally {
    if (previous === undefined) delete process.env.RESULTS_DIR;
    else process.env.RESULTS_DIR = previous;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("missing calendar days and absent providers do not carry previous measurements forward", () => {
  const result = summarizeProxyGetHistory([entry("2026-10-06"), entry("2026-10-08", { provider: "KERNEL" })], "US");
  assert.deepEqual(result.days.map(d => d.date), ["2026-10-06", "2026-10-07", "2026-10-08"]);
  assert.deepEqual(result.days[1].providers, []);
  assert.deepEqual(result.selected.providers.map(p => p.provider), ["KERNEL"]);
  assert.deepEqual(result.overview.providers.map(p => p.provider).sort(), ["KERNEL", "STEEL"]);
  assert.equal(result.overview.providers.find(p => p.provider === "STEEL")?.runDate, "2026-10-06");
});

test("overview and history retain each provider across targets while selected-day exports stay strict", () => {
  const rows = [entry("2026-10-07", { get_ms: 800 }), entry("2026-10-08", { get_ms: 200 }),
    entry("2026-10-11", { provider: "TILION", url: "https://new-target.example/payload", get_ms: 1800 }),
    entry("2026-10-11", { provider: "LIGHTPANDA", url: "https://new-target.example/payload", status: "unsupported", get_ms: null, cost_usd: null })];
  const latest = summarizeProxyGetHistory(rows, "US");
  assert.equal(latest.overview.providers.length, 3);
  const steel = latest.overview.providers.find(p => p.provider === "STEEL")!;
  assert.equal(steel.runDate, "2026-10-08");
  assert.equal(steel.medianGetMs, 200);
  assert.equal(steel.attempts, 1, "older suites are never pooled");
  assert.equal(latest.overview.workload, null, "different targets have no shared workload");
  assert.deepEqual(latest.selected.providers.map(p => p.provider).sort(), ["LIGHTPANDA", "TILION"]);
  assert.equal(latest.days.find(d => d.date === "2026-10-08")!.providers[0].medianGetMs, 200);
  assert.deepEqual(latest.workloadChangeDates, []);
  const older = summarizeProxyGetHistory(rows, "US", "2026-10-08");
  assert.deepEqual(older.overview.providers.map(p => p.provider), ["STEEL"], "historical overview never leaks future runs");
  assert.deepEqual(older.days.find(d => d.date === "2026-10-11")!.providers, []);
});

test("rolling history includes all eight recorded providers despite different run dates and target hosts", () => {
  const providers = ["BROWSERBASE", "STEEL", "KERNEL", "NOTTE", "HYPERBROWSER", "ANCHORBROWSER", "BROWSER_USE"] as const;
  const rows = providers.map((provider, i) => entry("2026-10-08", { provider, get_ms: 100 + i * 100 }));
  rows.push(entry("2026-10-11", { provider: "TILION", url: "https://new-target.example/payload", get_ms: 1800 }));
  const history = summarizeProxyGetHistory(rows, "US");
  assert.deepEqual(history.days[0].providers.map(p => p.provider).sort(), [...providers].sort());
  assert.deepEqual(history.days.slice(1, 3).map(d => d.providers), [[], []], "missing days remain gaps");
  assert.deepEqual(history.days[3].providers.map(p => p.provider), ["TILION"]);
  assert.deepEqual(history.workloadChangeDates, []);
  const rolling = proxyRollingAverage(history.days, "medianGetMs", 7);
  assert.equal(rolling[0].providers.length, 7);
  assert.equal(rolling[3].providers[0].value, 1800);
});

test("a provider's changed workload retains history and resets only its own average", () => {
  const rows = [entry("2026-10-07", { get_ms: 900 }),
    entry("2026-10-07", { provider: "KERNEL", url: "https://other-target.example/payload", get_ms: 400 }),
    entry("2026-10-08", { url: "https://new-target.example/payload", get_ms: 200 }),
    entry("2026-10-08", { provider: "KERNEL", url: "https://other-target.example/payload", get_ms: 600 })];
  const history = summarizeProxyGetHistory(rows, "US");
  assert.deepEqual(history.workloadChangeDates, ["2026-10-08"]);
  assert.deepEqual(history.days[0].providers.map(p => p.provider).sort(), ["KERNEL", "STEEL"]);
  assert.equal(history.days[0].compatible, true, "changed workloads retain usable results");
  assert.deepEqual(history.days[1].providers.map(p => p.provider).sort(), ["KERNEL", "STEEL"]);
  const rolling = proxyRollingAverage(history.days, "medianGetMs", 7);
  assert.equal(rolling[1].providers.find(p => p.provider === "STEEL")?.value, 200);
  assert.equal(rolling[1].providers.find(p => p.provider === "KERNEL")?.value, 500);
});

test("latest suite without the selected country does not resurrect an earlier country-only run", () => {
  const result = summarizeProxyGetHistory([entry("2026-10-08"), entry("2026-10-08", { run_id: "rerun", country: "FR", created_at: "2026-10-08T11:00:00Z" })], "US");
  assert.deepEqual(result.selected.providers, []);
  assert.deepEqual(result.days[0].providers, []);
  assert.deepEqual(result.overview.providers, []);
});

test("changed timeout history stays visible whichever date is selected", () => {
  const rows = [entry("2026-10-07", { timeout_ms: 20000 }), entry("2026-10-08")];
  const latest = summarizeProxyGetHistory(rows, "US");
  assert.deepEqual(latest.workloadChangeDates, ["2026-10-08"]);
  assert.equal(latest.days[0].providers[0].medianGetMs, 100);
  const older = summarizeProxyGetHistory(rows, "US", "2026-10-07");
  assert.equal(older.selected.workload?.timeoutMs, 20000);
  assert.deepEqual(older.workloadChangeDates, ["2026-10-08"]);
  assert.equal(older.days[1].providers[0].medianGetMs, 100);
});

test("a suite crossing midnight keeps all its samples in one final UTC day", () => {
  const result = summarizeProxyGetHistory([entry("2026-10-07", { run_id: "crossing", created_at: "2026-10-07T23:59:00Z" }),
    entry("2026-10-08", { run_id: "crossing", created_at: "2026-10-08T00:01:00Z", get_ms: 300 })], "US");
  assert.deepEqual(result.dates, ["2026-10-08"]);
  assert.equal(result.selected.providers[0].attempts, 2);
  assert.equal(result.days[0].providers[0].medianGetMs, 200);
});

test("unknown costs stay null and empty history has no synthetic days", () => {
  const result = summarizeProxyGetHistory([entry("2026-10-08", { cost_usd: null })], "US");
  assert.equal(result.days[0].providers[0].costPerSuccessUsd, null);
  const empty = summarizeProxyGetHistory([], "US");
  assert.deepEqual(empty.days, []);
  assert.deepEqual(empty.dates, []);
  assert.equal(empty.selectedDate, null);
});

test("filesystem history reads every dated folder while existing latest loading stays unchanged", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-history-"));
  const original = process.env.RESULTS_DIR;
  try {
    for (const date of ["2026-10-07", "2026-10-08"]) {
      const dir = path.join(base, "proxy-get", "steel", date);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "results.jsonl"), JSON.stringify(entry(date)) + "\n");
    }
    process.env.RESULTS_DIR = base;
    const history = await loadProxyGetHistory("US", "2026-10-07");
    assert.deepEqual(history.dates, ["2026-10-07", "2026-10-08"]);
    assert.equal(history.selected.providers[0].runDate, "2026-10-07");
    assert.equal((await loadProxyGet("US")).providers[0].runDate, "2026-10-08");
    const exported = await GET(new Request("http://localhost/api/proxy-get?country=US&date=2026-10-07"));
    assert.equal(exported.status, 200);
    assert.equal((await exported.json()).providers[0].runDate, "2026-10-07");
    const newDir = path.join(base, "proxy-get", "tilion", "2026-10-11");
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "results.jsonl"), JSON.stringify(entry("2026-10-11", { provider: "TILION", url: "https://new-target.example/payload" })) + "\n");
    const overview = await GET(new Request("http://localhost/api/proxy-get?country=US&date=2026-10-11&view=overview"));
    assert.equal(overview.status, 200);
    assert.deepEqual((await overview.json()).providers.map((p: { provider: string }) => p.provider).sort(), ["STEEL", "TILION"]);
    const daily = await GET(new Request("http://localhost/api/proxy-get?country=US&date=2026-10-11"));
    assert.deepEqual((await daily.json()).providers.map((p: { provider: string }) => p.provider), ["TILION"]);
    assert.equal((await GET(new Request("http://localhost/api/proxy-get?country=US&date=2026-10-06"))).status, 404);
    assert.equal((await GET(new Request("http://localhost/api/proxy-get?date=invalid"))).status, 400);
  } finally {
    if (original === undefined) delete process.env.RESULTS_DIR;
    else process.env.RESULTS_DIR = original;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("GitHub fallback loads historical folders and keeps default exports on the latest folder", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-history-remote-"));
  const originalDirectory = process.env.RESULTS_DIR;
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  try {
    process.env.RESULTS_DIR = base;
    globalThis.fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/index.json")) return new Response("", { status: 404 });
      requests.push(url);
      if (url.includes("api.github.com") && url.includes("contents/results/proxy-get/steel")) return Response.json([
        { name: "2026-10-07", type: "dir" }, { name: "2026-10-08", type: "dir" }, { name: "README.md", type: "file" },
      ]);
      if (url.includes("api.github.com")) return Response.json([{ name: "steel", type: "dir" }]);
      const date = url.includes("2026-10-07") ? "2026-10-07" : "2026-10-08";
      return new Response(JSON.stringify(entry(date)) + "\n");
    };
    const history = await loadProxyGetHistory("US", "2026-10-07");
    assert.deepEqual(history.dates, ["2026-10-07", "2026-10-08"]);
    assert.equal(history.selected.providers[0].runDate, "2026-10-07");
    requests.length = 0;
    const latest = await loadProxyGet("US");
    assert.equal(latest.providers[0].runDate, "2026-10-08");
    assert.equal(requests.filter(url => url.includes("raw.githubusercontent.com")).length, 1);
    assert.ok(requests.some(url => url.includes("2026-10-08/results.jsonl")));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDirectory === undefined) delete process.env.RESULTS_DIR;
    else process.env.RESULTS_DIR = originalDirectory;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("Vercel reads fresh indexed results instead of immutable build files or the Contents API", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-vercel-"));
  const cwd = process.cwd();
  const originalDirectory = process.env.RESULTS_DIR;
  const originalVercel = process.env.VERCEL;
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  fs.mkdirSync(path.join(base, "web"));
  const old = path.join(base, "results/proxy-get/steel/2026-10-01");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "results.jsonl"), JSON.stringify(entry("2026-10-01")) + "\n");
  try {
    process.chdir(path.join(base, "web"));
    delete process.env.RESULTS_DIR;
    process.env.VERCEL = "1";
    globalThis.fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      assert.ok(url.startsWith("https://raw.githubusercontent.com/"), "directory API must not be used");
      if (url.endsWith("/index.json")) return Response.json({ version: 1, providers: [{ name: "steel", dates: ["2026-10-12"] }] });
      assert.ok(url.endsWith("/steel/2026-10-12/results.jsonl"));
      return new Response(JSON.stringify(entry("2026-10-12")) + "\n");
    };
    assert.equal((await loadProxyGet("US")).providers[0].runDate, "2026-10-12");
    assert.equal(requests.length, 2);
  } finally {
    process.chdir(cwd);
    globalThis.fetch = originalFetch;
    if (originalDirectory === undefined) delete process.env.RESULTS_DIR; else process.env.RESULTS_DIR = originalDirectory;
    if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("preview pages and exports read the deployed revision while production follows main", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-preview-ref-"));
  const keys = ["RESULTS_DIR", "RESULTS_GITHUB_REPO", "RESULTS_GITHUB_BRANCH", "VERCEL", "VERCEL_ENV",
    "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF"] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const scenarios = [
    { environment: "preview", sha: "a".repeat(40), ref: "t3/proxy-geo-latency-benchmark", expected: "a".repeat(40) },
    { environment: "preview", ref: "t3/proxy-geo-latency-benchmark", expected: "t3/proxy-geo-latency-benchmark" },
    { environment: "production", sha: "a".repeat(40), ref: "main", expected: "main" },
    { environment: "preview", sha: "a".repeat(40), override: "published-results", expected: "published-results" },
    { environment: "preview", expected: "main" },
  ];
  try {
    for (const scenario of scenarios) {
      for (const key of keys) delete process.env[key];
      process.env.RESULTS_DIR = base;
      process.env.RESULTS_GITHUB_REPO = "nottelabs/browserarena";
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = scenario.environment;
      if (scenario.sha) process.env.VERCEL_GIT_COMMIT_SHA = scenario.sha;
      if (scenario.ref) process.env.VERCEL_GIT_COMMIT_REF = scenario.ref;
      if (scenario.override) process.env.RESULTS_GITHUB_BRANCH = scenario.override;
      const requests: string[] = [];
      globalThis.fetch = async input => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push(url);
        assert.ok(url.startsWith(`https://raw.githubusercontent.com/nottelabs/browserarena/${scenario.expected}/results/proxy-get/`));
        if (url.endsWith("/index.json")) return Response.json({ version: 1, providers: [
          { name: "steel", dates: ["2026-10-12"] }, { name: "notte", dates: ["2026-10-12"] },
        ] });
        return new Response(JSON.stringify(entry("2026-10-12", { provider: url.includes("/notte/") ? "NOTTE" : "STEEL" })) + "\n");
      };
      const history = await loadProxyGetHistory("US");
      assert.equal(history.overview.providers.length, 2);
      assert.deepEqual(history.dates, ["2026-10-12"]);
      const exported = await GET(new Request("https://fixture.example/api/proxy-get?country=US&view=overview"));
      assert.equal(exported.status, 200);
      assert.equal((await exported.json()).providers.length, 2);
      assert.ok(requests.length >= 6, "both the page history and API must load the index and both providers");
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
});
