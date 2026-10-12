/**
 * The browser-throughput summary: strict vs partial success, per-action percentiles,
 * drift, throughput ranking, and cost per 1,000 actions.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_ACTION_TYPES,
  costPer1kActions,
  rankBrowserThroughput,
  summarizeBrowserThroughput,
  type AgentActionEntry,
  type BrowserThroughputEntry,
} from "./browser-throughput-shared";

const META = { displayName: "Test", url: "#" };

function loop(loopIndex: number, base: number, failAt?: number): AgentActionEntry[] {
  const types = ["navigate", "waitForSelector", "screenshot", "textContent", "click", "waitForSelector", "screenshot", "textContent", "goBack", "waitForSelector"] as const;
  return types.map((type, i) => ({
    index: (loopIndex - 1) * 10 + i + 1,
    loop: loopIndex,
    type,
    duration_ms: base + i,
    success: failAt !== i,
    error_message: failAt === i ? "boom" : null,
    skipped: false,
  }));
}

function session(partial: Partial<BrowserThroughputEntry> & { actions: AgentActionEntry[] }): BrowserThroughputEntry {
  const completed = partial.actions.filter((a) => a.success).length;
  const taskMs = partial.actions.reduce((s, a) => s + a.duration_ms, 0);
  const loops = Math.max(...partial.actions.map((a) => a.loop));
  const loopMs = (l: number) => partial.actions.filter((a) => a.loop === l).reduce((s, a) => s + a.duration_ms, 0);
  return {
    created_at: "2026-10-12T04:00:00.000Z",
    id: "s",
    provider: "TEST",
    concurrency: 1,
    success: completed === partial.actions.length,
    error_stage: null,
    error_message: null,
    session_creation_ms: 100,
    session_connect_ms: 50,
    session_release_ms: 20,
    loops,
    actions_total: partial.actions.length,
    actions_completed: completed,
    task_ms: taskMs,
    actions_per_second: taskMs > 0 ? completed / (taskMs / 1000) : null,
    first_loop_ms: loopMs(1),
    last_loop_ms: loopMs(loops),
    ...partial,
  };
}

test("strict success counts sessions, action completion counts actions", () => {
  const entries = [
    session({ actions: loop(1, 100) }),
    session({ actions: loop(1, 100, 4) }), // one failed click
  ];
  const s = summarizeBrowserThroughput("TEST", entries, META, null, null)!;
  assert.equal(s.successRate, 50);
  assert.equal(s.actionCompletionRate, 95);
  assert.equal(s.actionsPerSession, 10);
  assert.equal(s.totalRuns, 2);
});

test("per-action percentiles only use successful, attempted actions", () => {
  const entries = [session({ actions: loop(1, 100, 4) }), session({ actions: loop(1, 200) })];
  const s = summarizeBrowserThroughput("TEST", entries, META, null, null)!;
  // click durations: the failed one (104) is excluded, leaving 204.
  assert.equal(s.perAction.click.median, 204);
  // every type is present even if empty
  for (const type of AGENT_ACTION_TYPES) assert.ok(type in s.perAction);
  assert.equal(s.perAction.navigate.median, 150);
});

test("drift is the median last/first loop ratio, and null for single-loop sessions", () => {
  const single = summarizeBrowserThroughput("TEST", [session({ actions: loop(1, 100) })], META, null, null)!;
  assert.equal(single.driftRatio, null);

  const multi = summarizeBrowserThroughput(
    "TEST",
    [session({ actions: [...loop(1, 100), ...loop(2, 100), ...loop(3, 200)] })],
    META,
    null,
    null
  )!;
  // loop 1 sums to 1045, loop 3 to 2045
  assert.equal(multi.driftRatio, Math.round((2045 / 1045) * 100) / 100);
});

test("drift ignores sessions whose first or last loop had a failed or skipped action", () => {
  const broken = session({ actions: [...loop(1, 100), ...loop(2, 100, 4)] }); // last loop has a failed click
  const clean = session({ actions: [...loop(1, 100), ...loop(2, 300)] });
  const s = summarizeBrowserThroughput("TEST", [broken, clean], META, null, null)!;
  // Only the clean session counts: loop 1 sums to 1045, loop 2 to 3045.
  assert.equal(s.driftRatio, Math.round((3045 / 1045) * 100) / 100);
  const onlyBroken = summarizeBrowserThroughput("TEST", [broken], META, null, null)!;
  assert.equal(onlyBroken.driftRatio, null);
});

test("an action type with no successful sample reports zero samples, not zero milliseconds", () => {
  const actions = loop(1, 100, 4); // click failed
  const s = summarizeBrowserThroughput("TEST", [session({ actions })], META, null, null)!;
  assert.equal(s.perAction.click.samples, 0);
  assert.equal(s.perAction.navigate.samples, 1);
});

test("an infrastructure failure contributes to success rate but not to timings", () => {
  const entries = [
    session({ actions: loop(1, 100) }),
    session({ actions: [], task_ms: null, actions_per_second: null, success: false, error_stage: "connect_over_cdp", actions_total: 10, actions_completed: 0 }),
  ];
  const s = summarizeBrowserThroughput("TEST", entries, META, null, null)!;
  assert.equal(s.successRate, 50);
  assert.equal(s.taskMs.median, 1045);
});

test("cost per 1,000 actions bills one long session with the provider's granularity", () => {
  const perMinute = { ratePerHour: 0.12, billing: "per_minute" as const, minimumSeconds: 60, perSessionCreationFee: 0 };
  // 4 actions/s -> 250 s -> rounded up to 300 s -> 300/3600 * 0.12
  assert.equal(costPer1kActions(4, perMinute), 0.01);
  const perSecond = { ratePerHour: 0.06, billing: "per_second" as const, minimumSeconds: 0, perSessionCreationFee: 0.01 };
  // 2 actions/s -> 500 s -> 500/3600 * 0.06 + fee
  assert.equal(costPer1kActions(2, perSecond), Math.round((500 / 3600 * 0.06 + 0.01) * 1e6) / 1e6);
  const per30 = { ratePerHour: 0.15, billing: "per_30_seconds" as const, minimumSeconds: 30, perSessionCreationFee: 0 };
  // 4 actions/s -> 250 s -> rounded up to 270 s -> 270/3600 * 0.15
  assert.equal(costPer1kActions(4, per30), Math.round((270 / 3600) * 0.15 * 1e6) / 1e6);
  assert.equal(costPer1kActions(null, perSecond), null);
  assert.equal(costPer1kActions(0, perSecond), null);
  assert.equal(costPer1kActions(2, null), null);
});

test("ranking is by median throughput and leaves unmeasured providers unranked", () => {
  const fast = summarizeBrowserThroughput("FAST", [session({ actions: loop(1, 10) })], META, null, null)!;
  const slow = summarizeBrowserThroughput("SLOW", [session({ actions: loop(1, 500) })], META, null, null)!;
  const dead = summarizeBrowserThroughput(
    "DEAD",
    [session({ actions: [], task_ms: null, actions_per_second: null, success: false, actions_completed: 0 })],
    META,
    null,
    null
  )!;
  const ranked = rankBrowserThroughput([slow, dead, fast]);
  assert.deepEqual(ranked.map((r) => [r.provider, r.rank]), [["FAST", 1], ["SLOW", 2], ["DEAD", 0]]);
});

test("empty input yields no row", () => {
  assert.equal(summarizeBrowserThroughput("X", [], META, null, null), null);
});
