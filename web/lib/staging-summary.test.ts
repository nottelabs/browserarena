import assert from "node:assert/strict";
import test from "node:test";
import { stagingSummary, stagingSummaryMessage, type LifecycleSteps, type StagingSummaryInput } from "./staging-summary";

const DATE = "2026-11-09";
const STEPS: LifecycleSteps = { creation: 150, connect: 25, goto: 90, release: 35 };
const life = (steps: Partial<LifecycleSteps> = {}, over: Partial<NonNullable<StagingSummaryInput["lifecycle"][number]["prod"]>> = {}) => ({
  runDate: DATE, totalRuns: 100, successRate: 100, steps: { ...STEPS, ...steps }, ...over,
});
const thr = (over: Partial<NonNullable<StagingSummaryInput["throughput"]["prod"]>> = {}) => ({
  runDate: DATE, totalRuns: 20, successRate: 90, actionsPerSecond: 4.18, taskMs: 2400, ...over,
});
const input = (over: Partial<StagingSummaryInput> = {}): StagingSummaryInput => ({
  date: DATE,
  lifecycle: [{ concurrency: 1, prod: life(), staging: life({ creation: 160 }) }],
  throughput: { prod: thr(), staging: thr({ actionsPerSecond: 4.2 }) },
  pageUrl: "https://staging-console.notte.cc/api/admin/browserarena-internal",
  ...over,
});
type Message = ReturnType<typeof stagingSummaryMessage>;
const sections = (m: Message) => m.blocks.filter((b) => b.type === "section").map((b) => (b as { text: { text: string } }).text.text);
/** The table line for a metric, e.g. "c1 navigate". */
const row = (m: Message, label: string) => sections(m).join("\n").split("\n").find((l) => l.startsWith(`${label} `)) ?? "";
const c1 = (prod: Partial<LifecycleSteps>, staging: Partial<LifecycleSteps>, over: { prod?: number; staging?: number } = {}) =>
  input({ lifecycle: [{ concurrency: 1, prod: life(prod, { successRate: over.prod ?? 100 }), staging: life(staging, { successRate: over.staging ?? 100 }) }] });

test("a healthy day is green, not an alert, with each step in aligned columns", () => {
  const { alert, message: m } = stagingSummary(input());
  assert.equal(alert, false);
  assert.equal(m.blocks[0]!.type, "header");
  assert.match(m.text, /^🟢 Notte staging vs production · Mon, Nov 9, 2026: No gross gap to production\./);
  assert.match(row(m, "c1 create"), /^c1 create\s+150 ms\s+160 ms\s+\+7%\s+🟢$/);
  assert.match(row(m, "c1 navigate"), /^c1 navigate\s+90 ms\s+90 ms\s+=\s+🟢$/);
  assert.match(row(m, "actions/s"), /4\.18\s+4\.20\s+=\s+🟢$/);
  const lifecycle = sections(m).find((t) => t.includes("Browser Lifecycle"))!;
  assert.match(lifecycle, /```\n\s+Production\s+Staging\s+Change\n/);
  const lines = lifecycle.split("\n").filter((l) => /🟢|🔴/.test(l));
  assert.equal(lines.length, 5);
  assert.equal(new Set(lines.map((l) => l.indexOf("🟢"))).size, 1);
  assert.doesNotMatch(lifecycle, /p90|c10/);
  assert.match(JSON.stringify(m.blocks), /staging-console\.notte\.cc\/api\/admin\/browserarena-internal/);
});

test("a step is red only when at least 2× and 100 ms slower than production", () => {
  const level = (prod: number, staging: number) => row(stagingSummaryMessage(c1({ goto: prod }, { goto: staging })), "c1 navigate").slice(-2);
  assert.equal(level(100, 180), "🟢");
  assert.equal(level(300, 590), "🟢"); // 1.97×
  assert.equal(level(30, 90), "🟢"); // 3× but only 60 ms
  assert.equal(level(90, 190), "🔴");
  const bad = stagingSummary(c1({ goto: 90 }, { goto: 300 }));
  assert.equal(bad.alert, true);
  assert.match(row(bad.message, "c1 navigate"), /90 ms\s+300 ms\s+3\.3×\s+🔴$/);
  assert.match(bad.message.text, /^🔴 .*: Staging is far behind production on 1 of 8 metrics\. Biggest gap: c1 navigate, 300 ms on staging vs 90 ms on production \(3\.3× worse\)\./);
});

test("success is red from 10 points down", () => {
  assert.equal(stagingSummary(c1({}, {}, { staging: 91 })).alert, false);
  const bad = stagingSummary(c1({}, {}, { staging: 90 }));
  assert.equal(bad.alert, true);
  assert.match(row(bad.message, "c1 success"), /100%\s+90%\s+−10 pt\s+🔴$/);
});

test("throughput is red at half production's actions/s or twice its task time", () => {
  const near = stagingSummary(input({ throughput: { prod: thr({ actionsPerSecond: 5, taskMs: 2000 }), staging: thr({ actionsPerSecond: 4.2, taskMs: 2380 }) } }));
  assert.equal(near.alert, false);
  assert.match(row(near.message, "actions/s"), /5\.00\s+4\.20\s+−16%\s+🟢$/);
  const far = stagingSummary(input({ throughput: { prod: thr({ actionsPerSecond: 5, taskMs: 2000 }), staging: thr({ actionsPerSecond: 2.5, taskMs: 4000 }) } }));
  assert.equal(far.alert, true);
  assert.match(row(far.message, "actions/s"), /5\.00\s+2\.50\s+−50%\s+🔴$/);
  assert.match(row(far.message, "task time"), /2,000 ms\s+4,000 ms\s+2\.0×\s+🔴$/);
});

test("missed or empty staging runs are red and called out instead of compared", () => {
  const { alert, message: m } = stagingSummary(input({
    lifecycle: [{ concurrency: 1, prod: life(), staging: null, stagingRan: true }],
    throughput: { prod: thr(), staging: null, stagingRan: false },
  }));
  assert.equal(alert, true);
  assert.match(m.text, /^🔴 .*Staging did not run completely\./);
  const text = sections(m).join("\n");
  assert.match(text, /c1: 🔴 Staging ran on 2026-11-09 but recorded no samples/);
  assert.match(text, /Browser Throughput.*\n🔴 No staging run for 2026-11-09\./);
  const stale = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life(), staging: life({}, { runDate: "2026-11-08" }) }] }));
  assert.match(sections(stale).join("\n"), /c1: 🔴 No staging run for 2026-11-09 \(latest is 2026-11-08\)\./);
  assert.equal(row(stale, "c1 create"), "");
});

test("a missing production run is not compared and is no alert on its own", () => {
  const { alert, message: m } = stagingSummary(input({
    lifecycle: [{ concurrency: 1, prod: null, staging: life() }],
    throughput: { prod: null, staging: thr() },
  }));
  assert.equal(alert, false);
  assert.match(row(m, "c1 create"), /^c1 create\s+—\s+150 ms\s+—\s+⚪$/);
  assert.match(row(m, "actions/s"), /—\s+4\.18\s+—\s+⚪$/);
  assert.match(m.text, /No gross gap to production; 8 of 8 metrics have no production run to compare\./);
  const text = sections(m).join("\n");
  assert.match(text, /⚪ c1: no production run for 2026-11-09 to compare\./);
  assert.match(text, /⚪ No production run for 2026-11-09 to compare\./);
});

test("failed runs with no successful samples are shown as unmeasured, never as infinite gaps", () => {
  const { alert, message: m } = stagingSummary(input({
    lifecycle: [{ concurrency: 1, prod: life({ creation: 0, connect: 0, goto: 0, release: 0 }, { successRate: 0 }), staging: life() }],
    throughput: { prod: thr(), staging: thr({ actionsPerSecond: 0, taskMs: 0, successRate: 0 }) },
  }));
  assert.doesNotMatch(JSON.stringify(m), /Infinity|NaN/);
  assert.equal(alert, true);
  assert.match(row(m, "c1 create"), /^c1 create\s+—\s+150 ms\s+—\s+⚪$/);
  assert.match(row(m, "actions/s"), /4\.18\s+—\s+—\s+🔴$/);
  assert.match(row(m, "success"), /90%\s+0%\s+−90 pt\s+🔴$/);
  assert.doesNotMatch(m.text, /Biggest gap/);
});

test("each group shows its sample counts on both targets", () => {
  const m = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life({}, { totalRuns: 100 }), staging: life({}, { totalRuns: 12 }) }] }));
  assert.match(row(m, "c1 runs"), /^c1 runs\s+100\s+12$/);
  assert.match(row(m, "runs"), /^runs\s+20\s+20$/);
});

test("staging's own history: not judged yet, within baseline, or regressed, and only a regression alerts", () => {
  const check = (over: Partial<NonNullable<StagingSummaryInput["baseline"]>[number]>) => ({
    concurrency: 1, status: "ok" as const, runDays: 30, runDaysNeeded: 10, total: { baseline: 410, current: 425 }, breaches: [], ...over,
  });
  const history = (m: Message) => sections(m).find((t) => t.includes("Staging vs its own history")) ?? "";

  assert.equal(history(stagingSummaryMessage(input())), "");

  const early = stagingSummary(input({ baseline: [check({ status: "unknown", runDays: 3, total: null })] }));
  assert.match(history(early.message), /⚪ c1: 3 of 10 run-days so far, not judged yet\./);
  assert.equal(early.alert, false);

  const fine = stagingSummary(input({ baseline: [check({})] }));
  assert.match(history(fine.message), /🟢 c1: within its baseline \(median 425 ms over the last 3 runs, 410 ms before\)\./);
  assert.equal(fine.alert, false);

  const bad = stagingSummary(input({ baseline: [check({
    status: "degraded",
    breaches: [
      { label: "session creation", unit: "ms", baseline: 150, current: 600, ratio: 4, onsetDate: "2026-11-20" },
      { label: "success rate", unit: "percent", baseline: 100, current: 90, ratio: 0.9, onsetDate: "2026-11-21" },
    ],
  })] }));
  assert.equal(bad.alert, true);
  assert.match(history(bad.message), /🔴 c1: session creation 150 ms → 600 ms \(4\.0×\) since 2026-11-20; success rate 100% → 90% since 2026-11-21\./);
  assert.match(bad.message.text, /^🔴 Notte staging vs production · Mon, Nov 9, 2026: Staging regressed against its own history on c1 \(session creation 150 ms → 600 ms \(4\.0×\) since 2026-11-20\)\. No gross gap to production\./);
});
