import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
