import type { ThroughputHistory } from "./browser-throughput-shared";

/**
 * A provider is expected from its first published run onward. This lets new
 * providers join without invalidating older days. Failed runs still have a
 * history point (with null timings), so account outages do not block a day.
 * The caller supplies history for one concurrency level, excluding warm-ups.
 */
export function throughputPublication(history: ThroughputHistory, requestedDate?: string) {
  const providers = history.providers.map((provider) => ({
    dates: new Set(provider.points.map((point) => point.date)),
    firstDate: provider.points.map((point) => point.date).sort()[0],
  })).filter((provider) => provider.firstDate !== undefined);
  // history.dates includes calendar gaps; only actual run days are selectable.
  const dates = [...new Set(providers.flatMap((provider) => [...provider.dates]))].sort();
  const coverage = dates.map((date) => {
    const expected = providers.filter((provider) => provider.firstDate! <= date);
    const reported = expected.filter((provider) => provider.dates.has(date)).length;
    return { date, reported, expected: expected.length, complete: reported === expected.length };
  });
  const completeDates = coverage.filter((day) => day.complete).map((day) => day.date);
  const latestCompleteDate = completeDates.at(-1);
  const selectedDate = requestedDate && dates.includes(requestedDate)
    ? requestedDate
    : latestCompleteDate ?? dates.at(-1);
  return { dates, coverage, completeDates, latestCompleteDate, selectedDate };
}
