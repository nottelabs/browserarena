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
type Message = ReturnType<typeof stagingSummaryMessage>;
const sections = (m: Message) => m.blocks.filter((b) => b.type === "section").map((b) => (b as { text: { text: string } }).text.text);
/** The table line for a metric, e.g. "c1 p90". */
const row = (m: Message, label: string) => sections(m).join("\n").split("\n").find((l) => l.startsWith(`${label} `)) ?? "";

test("a healthy day is green, with aligned production/staging/change columns", () => {
  const m = stagingSummaryMessage(input());
  assert.equal(m.blocks[0]!.type, "header");
  assert.match(m.text, /^🟢 Notte staging vs production · Mon, Nov 9, 2026: Staging matches production on every metric\./);
  assert.match(row(m, "c1 median"), /^c1 median\s+300 ms\s+320 ms\s+\+7%\s+🟢$/);
  assert.match(row(m, "c10 success"), /100%\s+100%\s+=\s+🟢$/);
  assert.match(row(m, "actions/s"), /4\.18\s+4\.20\s+=\s+🟢$/);
  const lifecycle = sections(m).find((t) => t.includes("Browser Lifecycle"))!;
  assert.match(lifecycle, /```\n\s+Production\s+Staging\s+Change\n/);
  // Columns line up: every table line puts "Change" values at the same end column.
  const lines = lifecycle.split("\n").filter((l) => /🟢|🔴|🟡/.test(l));
  assert.equal(new Set(lines.map((l) => l.indexOf("🟢"))).size, 1);
  assert.match(JSON.stringify(m.blocks), /staging-console\.notte\.cc\/api\/admin\/browserarena-internal/);
});

test("latency is red only past both 10% and 100 ms, yellow past one, and big gaps read as multiples", () => {
  const m = (prod: number, staging: number) => stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life({ totalTimeMs: prod }), staging: life({ totalTimeMs: staging }) }] }));
  assert.match(row(m(2000, 2100), "c1 median"), /\+5%\s+🟢$/);
  assert.match(row(m(300, 390), "c1 median"), /\+30%\s+🟡$/);
  assert.match(row(m(2000, 2160), "c1 median"), /\+8%\s+🟡$/);
  const bad = m(430, 2305);
  assert.match(row(bad, "c1 median"), /2,305 ms\s+5\.4×\s+🔴$/);
  assert.match(bad.text, /^🔴 .*Staging is worse than production on 1 of 6 metrics\. Biggest gap: c1 median, 2,305 ms on staging vs 430 ms on production \(5\.4× worse\)\./);
});

test("success drops: under 2 points is yellow, 2 or more is red", () => {
  const m = (staging: number) => stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life(), staging: life({ successRate: staging }) }] }));
  assert.match(row(m(99), "c1 success"), /99%\s+−1 pt\s+🟡$/);
  assert.match(row(m(98), "c1 success"), /98%\s+−2 pt\s+🔴$/);
});

test("throughput: fewer actions/s or longer tasks are flagged", () => {
  const m = stagingSummaryMessage(input({ throughput: { prod: thr({ actionsPerSecond: 5, taskMs: 2000 }), staging: thr({ actionsPerSecond: 4.5, taskMs: 2220 }) } }));
  assert.match(row(m, "actions/s"), /5\.00\s+4\.50\s+−10%\s+🟡$/);
  assert.match(row(m, "task time"), /2,000 ms\s+2,220 ms\s+\+11%\s+🔴$/);
  assert.match(m.text, /^🔴/);
});

test("missed or empty staging runs are red and called out instead of compared", () => {
  const m = stagingSummaryMessage(input({
    lifecycle: [
      { concurrency: 1, prod: life(), staging: life({ runDate: "2026-11-08" }) },
      { concurrency: 10, prod: life(), staging: null, stagingRan: true },
    ],
    throughput: { prod: thr(), staging: null, stagingRan: false },
  }));
  assert.match(m.text, /^🔴 .*Staging did not run completely\./);
  const text = sections(m).join("\n");
  assert.match(text, /c1: 🔴 No staging run for 2026-11-09 \(latest is 2026-11-08\)\./);
  assert.match(text, /c10: 🔴 Staging ran on 2026-11-09 but recorded no samples/);
  assert.match(text, /Browser Throughput.*\n🔴 No staging run for 2026-11-09\./);
  assert.equal(row(m, "c1 median"), "");
});

test("a missing production run is not compared and never reads as healthy", () => {
  const m = stagingSummaryMessage(input({
    lifecycle: [{ concurrency: 1, prod: null, staging: life() }, { concurrency: 10, prod: null, staging: life() }],
    throughput: { prod: null, staging: thr() },
  }));
  assert.match(row(m, "c1 median"), /^c1 median\s+—\s+300 ms\s+—\s+⚪$/);
  assert.match(row(m, "actions/s"), /—\s+4\.18\s+—\s+⚪$/);
  assert.match(m.text, /^⚪ .*Comparison incomplete: 7 of 7 metrics have no production baseline\./);
  assert.doesNotMatch(m.text, /matches production/);
  const text = sections(m).join("\n");
  assert.match(text, /⚪ c1: no production run for 2026-11-09 to compare\./);
  assert.match(text, /⚪ No production run for 2026-11-09 to compare\./);
});

test("failed runs with no successful samples are shown as unmeasured, never as infinite gaps", () => {
  // Staging throughput recorded no successful actions; production lifecycle c1 failed entirely.
  const m = stagingSummaryMessage(input({
    lifecycle: [{ concurrency: 1, prod: life({ totalTimeMs: 0, p90TotalMs: 0, successRate: 0 }), staging: life() }],
    throughput: { prod: thr(), staging: thr({ actionsPerSecond: 0, taskMs: 0, successRate: 0 }) },
  }));
  const json = JSON.stringify(m);
  assert.doesNotMatch(json, /Infinity|NaN/);
  assert.match(row(m, "c1 median"), /^c1 median\s+—\s+300 ms\s+—\s+⚪$/);
  assert.match(row(m, "actions/s"), /4\.18\s+—\s+—\s+🔴$/);
  assert.match(row(m, "task time"), /2,400 ms\s+—\s+—\s+🔴$/);
  assert.match(row(m, "success"), /90%\s+0%\s+−90 pt\s+🔴$/);
  assert.match(m.text, /^🔴 .*worse than production/);
  assert.doesNotMatch(m.text, /Biggest gap/);
});

test("c10 latency is shown but not compared, while c10 success still is", () => {
  const m = stagingSummaryMessage(input({
    lifecycle: [
      { concurrency: 1, prod: life(), staging: life() },
      { concurrency: 10, prod: life({ totalTimeMs: 457 }), staging: life({ totalTimeMs: 3787, successRate: 95 }) },
    ],
  }));
  assert.match(row(m, "c10 median"), /457 ms\s+3,787 ms\s+8\.3×\s+⚪$/);
  assert.match(row(m, "c10 success"), /100%\s+95%\s+−5 pt\s+🔴$/);
  assert.match(m.text, /Staging is worse than production on 1 of 7 metrics\./);
  assert.doesNotMatch(m.text, /Biggest gap|no production baseline/);
  assert.match(sections(m).join("\n"), /⚪ c10 latency: not compared\./);
  const healthy = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 10, prod: life(), staging: life({ totalTimeMs: 3787, p90TotalMs: 5676 }) }] }));
  assert.match(healthy.text, /^🟢 /);
});

test("each group shows its sample counts on both targets", () => {
  const m = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: life({ totalRuns: 100 }), staging: life({ totalRuns: 12 }) }] }));
  assert.match(row(m, "c1 runs"), /^c1 runs\s+100\s+12$/);
  assert.match(row(m, "runs"), /^runs\s+20\s+20$/);
});

test("staging's own history: not judged yet, within baseline, or regressed, and a regression leads the headline", () => {
  const check = (over: Partial<NonNullable<StagingSummaryInput["baseline"]>[number]>) => ({
    concurrency: 1, status: "ok" as const, runDays: 30, runDaysNeeded: 10, total: { baseline: 410, current: 425 }, breaches: [], ...over,
  });
  const history = (m: Message) => sections(m).find((t) => t.includes("Staging vs its own history")) ?? "";

  assert.equal(history(stagingSummaryMessage(input())), "");

  const early = stagingSummaryMessage(input({ baseline: [check({ status: "unknown", runDays: 3, total: null }), check({ concurrency: 10, status: "unknown", runDays: 3, total: null })] }));
  assert.match(history(early), /⚪ c1: 3 of 10 run-days so far, not judged yet\.\n⚪ c10: 3 of 10/);
  assert.match(early.text, /^🟢 /);

  const fine = stagingSummaryMessage(input({ baseline: [check({})] }));
  assert.match(history(fine), /🟢 c1: within its baseline \(median 425 ms over the last 3 runs, 410 ms before\)\./);

  const bad = stagingSummaryMessage(input({ baseline: [check({}), check({
    concurrency: 10,
    status: "degraded",
    breaches: [
      { label: "session creation", unit: "ms", baseline: 900, current: 3600, ratio: 4, onsetDate: "2026-11-20" },
      { label: "success rate", unit: "percent", baseline: 100, current: 90, ratio: 0.9, onsetDate: "2026-11-21" },
    ],
  })] }));
  assert.match(history(bad), /🔴 c10: session creation 900 ms → 3,600 ms \(4\.0×\) since 2026-11-20; success rate 100% → 90% since 2026-11-21\./);
  assert.match(bad.text, /^🔴 Notte staging vs production · Mon, Nov 9, 2026: Staging regressed against its own history on c10 \(session creation 900 ms → 3,600 ms \(4\.0×\) since 2026-11-20\)\. Staging matches production on every metric\./);
});
