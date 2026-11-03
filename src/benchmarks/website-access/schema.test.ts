import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { parseAccessReport, providerScores } from "./schema.js";
const raw = JSON.parse(fs.readFileSync(new URL("../../../results/website-access/2026-10-28/run.json", import.meta.url), "utf8"));
test("the reviewed campaign preserves every planned visit and its original screenshot", () => {
  const report = parseAccessReport(raw);
  assert.equal(report.visits.length, 300);
  assert.deepEqual(providerScores(report).map(p => [p.id,p.accessible,p.planned,p.sitesAccessible]), [["browser-use",53,60,19],["notte",27,60,11],["kernel",24,60,10],["steel",16,60,7],["browserbase",15,60,7]]);
  for (const v of report.visits) {
    const file = fs.readFileSync(new URL(`../../../web/public/website-access/${report.date}/${v.screenshot!.file}`,import.meta.url));
    assert.equal(createHash("sha256").update(file).digest("hex"),v.screenshot!.sha256,v.id);
  }
});
test("missing or duplicate outcomes cannot silently shrink the denominator", () => {
  const missing = structuredClone(raw); missing.visits.pop(); assert.throws(() => parseAccessReport(missing),/denominator/);
  const duplicate = structuredClone(raw); duplicate.visits[1] = duplicate.visits[0]; assert.throws(() => parseAccessReport(duplicate),/duplicate visit/);
});
test("follow-up recordings remain separate from scored outcomes", () => {
  const report = parseAccessReport(raw);
  assert.equal(report.visits.filter(v => v.replay!.kind === "original").length,180);
  assert.equal(report.visits.filter(v => v.replay!.kind === "followup").length,120);
  const changed = structuredClone(report); for (const v of changed.visits) v.replay!.kind = "followup";
  assert.deepEqual(providerScores(changed),providerScores(report));
});
test("unreviewed rows, private fields and unsafe asset paths are rejected", () => {
  for (const mutate of [
    (d: typeof raw) => {d.visits[0].reviewed=false;},
    (d: typeof raw) => {d.visits[0].session_id="private";},
    (d: typeof raw) => {d.visits[0].replay.signedUrl="private";},
    (d: typeof raw) => {d.providers[0].apiKey="private";},
    (d: typeof raw) => {d.visits[0].replay.file="../../secret.mp4";},
    (d: typeof raw) => {d.visits[0].outcome="solver_reported_success";},
  ]) {const d=structuredClone(raw);mutate(d);assert.throws(()=>parseAccessReport(d));}
});
