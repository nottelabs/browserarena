// A provider whose every run failed has no timing measurements: its latency
// fields are 0 because there was nothing to measure, not because it was fast.
export function hasSuccessfulRuns(stats: { successRate: number }): boolean {
  return stats.successRate > 0;
}

// Sorts rankable items with `compare` and appends the rest after them, so an
// unrankable item can never lead the table whatever the sort key or direction.
export function sortRanked<T>(
  items: readonly T[],
  isRankable: (item: T) => boolean,
  compare: (a: T, b: T) => number,
  compareUnranked: (a: T, b: T) => number
): T[] {
  const ranked = items.filter(isRankable).sort(compare);
  const unranked = items.filter((item) => !isRankable(item)).sort(compareUnranked);
  return [...ranked, ...unranked];
}
