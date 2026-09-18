export const HISTORY_RANGES = [
  { key: "1w", label: "Last week", days: 7 },
  { key: "1m", label: "Last month", days: 30 },
  { key: "3m", label: "Last 3 months", days: 90 },
] as const;

export type HistoryRangeKey = (typeof HISTORY_RANGES)[number]["key"];

// Earliest YYYY-MM-DD included in a window of `days` calendar days ending at `latest`.
export function rangeStartDate(latest: string, days: number): string {
  const start = new Date(`${latest}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

// Sorted run dates within `days` calendar days of the latest one, never before `floor`.
export function filterDatesToRange(
  dates: string[],
  days: number,
  floor: string
): string[] {
  const eligible = dates.filter((date) => date >= floor);
  const latest = eligible[eligible.length - 1];
  if (!latest) return eligible;
  const start = rangeStartDate(latest, days);
  return eligible.filter((date) => date >= start);
}

// A point with no value on either side draws no line segment, so it is only
// visible if it keeps its own marker.
export function isIsolatedPoint(
  values: ReadonlyArray<number | null | undefined>,
  index: number
): boolean {
  if (typeof values[index] !== "number") return false;
  return (
    typeof values[index - 1] !== "number" &&
    typeof values[index + 1] !== "number"
  );
}
