/**
 * Backtest of the regression detector against the real committed results.
 *
 * These assertions are the calibration record. If you change a threshold in
 * `DEFAULT_CONFIG`, this test tells you exactly which historical incidents you
 * started or stopped catching. Treat a diff here as a decision, not a chore.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadHistoricalLeaderboard } from "./data";
import type { HistoricalProviderPoint } from "./data-shared";
import {
  breachingMetricsAt,
  evaluateSeries,
  DEFAULT_CONFIG,
  type MetricKey,
} from "./regression";

const CONCURRENCY = 1;

async function pointsFor(provider: string): Promise<HistoricalProviderPoint[]> {
  const history = await loadHistoricalLeaderboard("hello-browser", CONCURRENCY);
  const series = history.providers.find((p) => p.provider === provider);
  assert.ok(series, `no history for ${provider}`);
  return series.points;
}

/** Replays the edge-triggered dedup and returns "<date>/<metrics>" per open event. */
function openEvents(points: HistoricalProviderPoint[]): string[] {
  const events: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const today = breachingMetricsAt(points, i);
    if (today === null) continue;
    const yesterday = breachingMetricsAt(points, i - 1);
    const opened = [...today].filter((m) => !yesterday?.has(m));
    if (opened.length) events.push(`${points[i].date}/${opened.join("+")}`);
  }
  return events;
}

function breachingOn(points: HistoricalProviderPoint[], date: string): Set<MetricKey> | null {
  const index = points.findIndex((p) => p.date === date);
  assert.ok(index >= 0, `no run on ${date}`);
  return breachingMetricsAt(points, index);
}

test("Notte: the 2026-09-05 release regression opens exactly one alert, on 09-06", async () => {
  const points = await pointsFor("NOTTE");

  // The whole incident produces ONE Slack message, not one per day for five days.
  assert.deepEqual(openEvents(points), ["2026-08-20/goto", "2026-09-06/release"]);
});

test("Notte: 2026-08-29 one-day spike does not alert", async () => {
  const points = await pointsFor("NOTTE");

  // creation 132 -> 960, goto 85 -> 622, back to normal on 08-30. A
  // day-over-day check fires here; K-of-N does not, because the neighbouring
  // days are clean and only 1 of 3 recent days breaches.
  for (const date of ["2026-08-29", "2026-08-30", "2026-08-31"]) {
    assert.deepEqual([...breachingOn(points, date)!], [], `alerted on ${date}`);
  }
});

test("Notte: 2026-09-01 connect blip does not alert", async () => {
  const points = await pointsFor("NOTTE");
  for (const date of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
    assert.deepEqual([...breachingOn(points, date)!], [], `alerted on ${date}`);
  }
});

test("Notte: onset day 2026-09-05 is not enough on its own", async () => {
  const points = await pointsFor("NOTTE");

  // 1 of 3 recent days breaching. This is the deliberate 24h detection floor:
  // with one run per day, K=2 cannot resolve faster. Do not add a "huge jump"
  // K=1 fast path — it would also fire on the 08-29 spike.
  assert.deepEqual([...breachingOn(points, "2026-09-05")!], []);
});

test("Notte: from 09-06 the release breach stays open and is not re-alerted", async () => {
  const points = await pointsFor("NOTTE");

  for (const date of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"]) {
    assert.deepEqual(
      [...breachingOn(points, date)!],
      ["release"],
      `expected a lone release breach on ${date}`
    );
  }

  // Only 09-06 is an *edge*; the rest are silent.
  const after0906 = openEvents(points).filter((e) => e > "2026-09-06/z");
  assert.deepEqual(after0906, []);
});

test("Notte: the alert names the culprit phase, not the derived total", async () => {
  const points = await pointsFor("NOTTE");
  const breaching = breachingOn(points, "2026-09-09")!;

  // total (383ms -> 1426ms) breaches too, but is suppressed so one root cause
  // produces one alert.
  assert.ok(breaching.has("release"));
  assert.ok(!breaching.has("total"));
});

test("Notte: the regression cannot poison its own baseline", async () => {
  const points = await pointsFor("NOTTE");
  const index = points.findIndex((p) => p.date === "2026-09-09");
  const series = evaluateSeries(
    points.slice(0, index + 1),
    { provider: "NOTTE", displayName: "Notte", concurrency: CONCURRENCY },
    new Date("2026-09-09T12:00:00Z")
  );

  const release = series.breaches.find((b) => b.metric === "release");
  assert.ok(release, "expected a release breach");

  // Four regressed days sit inside the baseline window by 09-09, but the
  // baseline is a median over 28 days, so it holds at the pre-regression value.
  assert.ok(
    release.baseline < 60,
    `baseline drifted to ${release.baseline}ms — poisoning guard failed`
  );
  assert.ok(release.ratio > 10, `expected a large ratio, got ${release.ratio}`);
  assert.equal(release.onsetDate, "2026-09-05");
  assert.equal(series.status, "degraded");
});

test("Tilion: cold start, then noise floor, then the real jump", async () => {
  const points = await pointsFor("TILION");

  // Only 12 run-days of history. The first 9 cannot be judged at all, and
  // `unknown` never pages — this is the cold-start guarantee for a newly
  // added provider.
  assert.equal(breachingOn(points, "2026-09-03"), null);

  // release sits at 6-8ms for days: ratios touch 1.3x but the delta is ~2ms,
  // so the absolute floor keeps it quiet.
  assert.deepEqual([...breachingOn(points, "2026-09-07")!], []);

  // 6.5ms -> 134ms is huge, but it is one day. Still silent, by design.
  assert.deepEqual([...breachingOn(points, "2026-09-08")!], []);

  // Second bad day: release (-> 85ms) and the success-rate collapse to 58%.
  const latest = breachingOn(points, "2026-09-09")!;
  assert.ok(latest.has("release"), "expected the real release jump to breach");
  assert.ok(latest.has("successRate"), "expected the success-rate collapse to breach");
});

test("stale data is reported as stale, and staleness outranks degraded", async () => {
  const points = await pointsFor("NOTTE");

  // Same regressed data, evaluated a week later: the actionable fact becomes
  // the dead cron, not the latency.
  const series = evaluateSeries(
    points,
    { provider: "NOTTE", displayName: "Notte", concurrency: CONCURRENCY },
    new Date("2026-09-16T12:00:00Z")
  );
  assert.equal(series.status, "stale");
  assert.ok(series.ageHours! > DEFAULT_CONFIG.stalenessHours);
});

test("cold start reports unknown and never pages", async () => {
  const points = await pointsFor("NOTTE");
  const short = points.slice(0, DEFAULT_CONFIG.minBaselineDays + DEFAULT_CONFIG.recentDays - 1);

  const series = evaluateSeries(
    short,
    { provider: "NEW", displayName: "New Provider", concurrency: CONCURRENCY },
    new Date(`${short[short.length - 1].date}T12:00:00Z`)
  );
  assert.equal(series.status, "unknown");
  assert.equal(series.reason, "insufficient_history");
  assert.deepEqual(series.breaches, []);

  assert.equal(breachingMetricsAt(short, short.length - 1), null);
});

test("no-data series is unknown, not a false alarm", () => {
  const series = evaluateSeries(
    [],
    { provider: "EMPTY", displayName: "Empty", concurrency: CONCURRENCY },
    new Date()
  );
  assert.equal(series.status, "unknown");
  assert.equal(series.reason, "no_data");
});
