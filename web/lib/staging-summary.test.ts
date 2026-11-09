import assert from "node:assert/strict";
import test from "node:test";
import { stagingSummaryMessage, type StagingSummaryInput } from "./staging-summary";

const DATE = "2026-11-09";
const life = (over: Partial<NonNullable<StagingSummaryInput["lifecycle"][number]["prod"]>> = {}) => ({
  runDate: DATE, totalRuns: 100, successRate: 100, totalTimeMs: 300, p90TotalMs: 420, ...over,
});
const thr = (over: Partial<NonNullable<StagingSummaryInput["throughput"]["prod"]>> = {}) => ({
  runDate: DATE, totalRuns: 20, successRate: 90, actionsPerSecond: 4.18, taskMs: 2400, ...over,
});
const input = (over: Partial<StagingSummaryInput> = {}): StagingSummaryInput => ({
  date: DATE,
  lifecycle: [
    { concurrency: 1, prod: life(), staging: life({ totalTimeMs: 320 }) },
    { concurrency: 10, prod: life(), staging: life() },
  ],
  throughput: { prod: thr(), staging: thr({ actionsPerSecond: 4.2 }) },
  pageUrl: "https://staging-console.notte.cc/api/admin/browserarena-internal",
  ...over,
});
const text = (message: ReturnType<typeof stagingSummaryMessage>) => JSON.stringify(message.blocks);

test("a healthy day shows both targets with deltas and no warning", () => {
  const message = stagingSummaryMessage(input());
  assert.equal(message.text, `✅ Notte staging vs production — ${DATE}`);
  const body = text(message);
  assert.match(body, /production 100% ok · 300 ms · p90 420 ms · 100 runs \(2026-11-09\)/);
  assert.match(body, /staging 100% ok · 320 ms/);
  assert.match(body, /staging vs production: \+20 ms \(\+7%\)/);
  assert.match(body, /4\.20 actions\/s/);
  assert.doesNotMatch(body, /⚠️ No staging/);
  assert.match(body, /staging-console\.notte\.cc\/api\/admin\/browserarena-internal/);
});

test("slower staging is flagged only when worse by both 10% and 100 ms", () => {
  const small = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life({ totalTimeMs: 2000 }), staging: life({ totalTimeMs: 2090 }) }] }));
  assert.match(small.text, /^✅/);
  const shareOnly = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life({ totalTimeMs: 300 }), staging: life({ totalTimeMs: 390 }) }] }));
  assert.match(shareOnly.text, /^✅/);
  const both = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life({ totalTimeMs: 300 }), staging: life({ totalTimeMs: 450 }) }] }));
  assert.match(both.text, /^⚠️/);
  assert.match(text(both), /\+150 ms \(\+50%\)/);
});

test("lower staging success or throughput is flagged", () => {
  assert.match(stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life(), staging: life({ successRate: 99 }) }] })).text, /^⚠️/);
  assert.match(stagingSummaryMessage(input({ throughput: { prod: thr(), staging: thr({ actionsPerSecond: 3.5 }) } })).text, /^⚠️/);
});

test("a missing or stale staging run is called out instead of compared", () => {
  const message = stagingSummaryMessage(input({
    lifecycle: [{ concurrency: 1, prod: life(), staging: life({ runDate: "2026-11-08" }) }],
    throughput: { prod: thr(), staging: null },
  }));
  assert.match(message.text, /^⚠️/);
  const body = text(message);
  assert.match(body, /No staging run for 2026-11-09 \(latest 2026-11-08\)/);
  assert.match(body, /Browser Throughput.*No staging run for 2026-11-09\./);
  assert.doesNotMatch(body, /staging vs production:/);
});

test("a throughput task-time slowdown is flagged even when actions/s rounds just under 10%", () => {
  const message = stagingSummaryMessage(input({
    throughput: { prod: thr({ actionsPerSecond: 5, taskMs: 2000 }), staging: thr({ actionsPerSecond: 4.5, taskMs: 2220 }) },
  }));
  assert.match(message.text, /^⚠️/);
  assert.match(text(message), /task \+220 ms \(\+11%\)/);
});

test("a staging run folder without samples is reported as a failed run, not a missed one", () => {
  const body = text(stagingSummaryMessage(input({
    lifecycle: [{ concurrency: 1, prod: life(), staging: null, stagingRan: true }],
    throughput: { prod: thr(), staging: null, stagingRan: false },
  })));
  assert.match(body, /Staging ran on 2026-11-09 but recorded no samples/);
  assert.match(body, /Browser Throughput.*No staging run for 2026-11-09\./);
});
