import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStealth, rankStealth, loadStealthRuns, STEALTH_PROVIDERS } from "./stealth";

function fixture() {
  return { schemaVersion: 1, protocol: "site-access-1", date: "2026-11-04", weekOf: "2026-11-02", siteCount: 30, rounds: 3, proxyCountry: "US", providers: STEALTH_PROVIDERS.map(provider => ({ provider, accessible: 45, blocked: 40, errors: 5 })) };
}

test("rates retain the error denominator distinction", () => {
  const result = rankStealth(parseStealth(fixture()));
  assert.equal(result[0].rate, 45 / 85);
  assert.equal(result[0].errors, 5);
});
test("unknown and private fields are rejected at every level", () => {
  assert.throws(() => parseStealth({ ...fixture(), urls: ["private"] }));
  const value = fixture();
  Object.assign(value.providers[0], { sessionId: "private" });
  assert.throws(() => parseStealth(value));
});
test("malformed counts, dates and provider inventories are rejected", () => {
  for (const mutate of [(v: any) => v.providers.pop(), (v: any) => v.providers[0].accessible++, (v: any) => v.providers[1] = v.providers[0], (v: any) => v.date = "2026-02-30", (v: any) => v.weekOf = "2026-10-26"]) {
    const value = fixture(); mutate(value); assert.throws(() => parseStealth(value));
  }
});
test("history loads only valid aggregate files and fails on contaminated data", () => {
  const dir = mkdtempSync(join(tmpdir(), "score-history-"));
  try {
    assert.deepEqual(loadStealthRuns(dir), []);
    writeFileSync(join(dir, "2026-11-02.json"), JSON.stringify(fixture()));
    assert.equal(loadStealthRuns(dir)[0].weekOf, "2026-11-02");
    writeFileSync(join(dir, "2026-11-02.json"), JSON.stringify({ ...fixture(), websites: ["private"] }));
    assert.throws(() => loadStealthRuns(dir));
    writeFileSync(join(dir, "2026-11-02.json"), JSON.stringify(fixture()));
    writeFileSync(join(dir, "visits.jsonl"), "private");
    assert.throws(() => loadStealthRuns(dir));
  } finally { rmSync(dir, { recursive: true }); }
});
