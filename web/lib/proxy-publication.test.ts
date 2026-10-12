import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GET } from "../app/api/proxy-get/route";
import { loadProxyGetEntries } from "./proxy-get";
import { summarizeProxyGetHistory } from "./proxy-get-history";

const results = fileURLToPath(new URL("../../results", import.meta.url));
const suiteId = "premerge-50-2026-10-12";
const auditDir = path.join(results, "proxy-get/diagnostics/2026-10-12-premerge50");
const analysis = JSON.parse(fs.readFileSync(path.join(auditDir, "analysis.json"), "utf8"));
const providers = ["anchorbrowser", "browser-use", "browserbase", "hyperbrowser", "kernel", "lightpanda", "notte", "steel", "tilion"];
const countries = ["US", "FR", "BR", "IN", "JP"];
const readRows = (file: string) => fs.readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
const saved = providers.flatMap(provider => readRows(path.join(results, "proxy-get", provider, "2026-10-12/results.jsonl")));
const suite = saved.filter(row => row.run_id === suiteId);

test("published October 12 artifacts retain every attempt and prior Notte record", () => {
  assert.equal(suite.length, 1809);
  assert.equal(suite.filter(row => row.status === "success").length, 1712);
  assert.equal(suite.filter(row => row.status === "failed").length, 88);
  assert.equal(suite.filter(row => row.status === "unsupported").length, 9);
  assert.equal(new Set(suite.map(row => JSON.stringify([row.provider, row.country, row.created_at]))).size, 1809);
  for (const provider of providers) {
    const id = provider.toUpperCase().replaceAll("-", "_");
    for (const country of countries) {
      const rows = suite.filter(row => row.provider === id && row.country === country);
      const unsupported = provider === "lightpanda" || (provider === "tilion" && country !== "US");
      assert.equal(rows.length, unsupported ? 1 : 50, `${provider}/${country}`);
      assert.equal(rows.filter(row => row.status !== "unsupported").length, unsupported ? 0 : 50);
    }
  }
  for (const prior of analysis.preservation) {
    const file = fs.readFileSync(path.resolve(results, "..", prior.path));
    assert.equal(createHash("sha256").update(file.subarray(0, prior.prior_bytes)).digest("hex"), prior.prior_sha256);
  }
  assert.equal(saved.filter(row => row.run_id === "2031e9ca-fe52-4ac3-a2a7-eaba03aadcc5").length, 50);
  const control = readRows(path.join(results, "proxy-get/notte/2026-10-12/diagnostics/default-settings-results.jsonl"));
  assert.equal(control.length, 50);
  assert.ok(control.every(row => row.status === "failed"));
});

test("archived suite metadata covers the full run independently of replaceable daily metadata", () => {
  const archived = JSON.parse(fs.readFileSync(path.join(auditDir, "suite-metadata.json"), "utf8"));
  assert.equal(archived.version, 1);
  assert.equal(archived.run_id, suiteId);
  assert.deepEqual(Object.keys(archived.providers).sort(), [...providers].sort());
  for (const provider of providers) {
    // Dated _meta.json is replaced by same-day reruns and resumes. Historical
    // validation uses this suite's immutable publication snapshot instead.
    const meta = archived.providers[provider];
    assert.equal(meta.run_id, suiteId);
    assert.equal(meta.started_at, analysis.started_at);
    assert.equal(meta.finished_at, meta.suite_finished_at);
    assert.equal(meta.started_at, meta.suite_started_at);
    assert.ok(Date.parse(meta.final_batch_started_at) > Date.parse(meta.started_at));
    assert.equal(meta.final_batch_finished_at, meta.finished_at);
    const id = provider.toUpperCase().replaceAll("-", "_");
    assert.ok(suite.filter(row => row.provider === id).every(row =>
      Date.parse(row.created_at) >= Date.parse(meta.started_at) && Date.parse(row.created_at) <= Date.parse(meta.finished_at)));
  }
});

test("published files feed the latest suite to dashboard history and overview exports", async () => {
  const previous = process.env.RESULTS_DIR;
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-publication-"));
  // Read the actual published history, freezing only the cutoff so later
  // appended same-day suites do not change this publication's API fixture.
  const index = JSON.parse(fs.readFileSync(path.join(results, "proxy-get/index.json"), "utf8"));
  for (const provider of index.providers) {
    for (const date of provider.dates) {
      const relative = path.join("proxy-get", provider.name, date, "results.jsonl");
      const rows = readRows(path.join(results, relative)).filter(row => row.created_at <= analysis.finished_at);
      if (!rows.length) continue;
      fs.mkdirSync(path.dirname(path.join(snapshot, relative)), { recursive: true });
      fs.writeFileSync(path.join(snapshot, relative), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    }
  }
  process.env.RESULTS_DIR = snapshot;
  try {
    const entries = await loadProxyGetEntries(true);
    for (const country of countries) {
      const history = summarizeProxyGetHistory(entries, country, "2026-10-12");
      const response = await GET(new Request(`https://example.test/api/proxy-get?country=${country}&date=2026-10-12&view=overview`));
      assert.equal(response.status, 200);
      const exported = await response.json();
      assert.deepEqual(exported, history.overview);
      assert.equal(history.overview.providers.length, 9);
      for (const provider of history.overview.providers) {
        const unsupported = provider.provider === "LIGHTPANDA" || (provider.provider === "TILION" && country !== "US");
        assert.equal(provider.attempts, unsupported ? 0 : 50);
        assert.ok(provider.samples.every(row => row.run_id === suiteId));
        assert.equal(provider.successes, provider.samples.filter(row => row.status === "success").length);
        if (unsupported) {
          assert.equal(provider.medianGetMs, null);
          assert.equal(provider.costPerSuccessUsd, null);
          assert.equal(provider.successes, 0);
        }
      }
      const notte = history.overview.providers.find(p => p.provider === "NOTTE")!;
      const notteSuccesses: Record<string, number> = { US: 50, FR: 49, BR: 48, IN: 48, JP: 47 };
      assert.equal(notte.successes, notteSuccesses[country]);
    }
  } finally {
    if (previous === undefined) delete process.env.RESULTS_DIR;
    else process.env.RESULTS_DIR = previous;
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
});
