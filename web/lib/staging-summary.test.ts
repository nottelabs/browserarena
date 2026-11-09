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

test("a missing production run leaves staging numbers with an em dash to compare against", () => {
  const m = stagingSummaryMessage(input({ lifecycle: [{ concurrency: 1, prod: null, staging: life() }] }));
  assert.match(row(m, "c1 median"), /^c1 median\s+—\s+300 ms\s+—\s+🟢$/);
  assert.match(sections(m).join("\n"), /c1: no production run for 2026-11-09 to compare\./);
});
