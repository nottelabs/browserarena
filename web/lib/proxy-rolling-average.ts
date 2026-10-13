import type { ProxyHistoryDay } from "./proxy-get-history";

export type ProxyHistoryMetric = "medianGetMs" | "medianFirstByteMs" | "costPerSuccessUsd";

/** Equal-weight average of daily summaries in a trailing calendar-day window. */
export function proxyRollingAverage(days: ProxyHistoryDay[], metric: ProxyHistoryMetric, windowDays = 7) {
  const segments = new Map<string, { workloadKey: string; start: string }>();
  return days.map(day => {
    const start = new Date(`${day.date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - windowDays + 1);
    const lower = start.toISOString().slice(0, 10);
    const window = days.filter(d => d.date >= lower && d.date <= day.date);
    return { date: day.date, providers: day.providers.map(provider => {
      let segment = segments.get(provider.provider);
      if (!segment || segment.workloadKey !== provider.workloadKey) {
        segment = { workloadKey: provider.workloadKey, start: day.date };
        segments.set(provider.provider, segment);
      }
      const segmentStart = segment.start;
      const values = window.flatMap(d => {
        if (d.date < segmentStart) return [];
        const value = d.providers.find(p => p.provider === provider.provider)?.[metric];
        return typeof value === "number" ? [value] : [];
      });
      // A missing current measurement remains a gap rather than a carried value.
      return { provider: provider.provider, segmentStart, value: provider[metric] === null || !values.length ? null : values.reduce((a, b) => a + b, 0) / values.length, count: values.length };
    }) };
  });
}

/** Separate line series keep adjacent dates with different workloads unjoined. */
export function proxyHistoryChartData(days: ProxyHistoryDay[], metric: ProxyHistoryMetric, windowDays = 1) {
  const rolling = proxyRollingAverage(days, metric, windowDays);
  const series = new Map<string, { dataKey: string; provider: string }>();
  const data = rolling.map(day => {
    const row: Record<string, string | number | null> = { date: day.date };
    for (const point of day.providers) {
      const key = JSON.stringify([point.provider, point.segmentStart]);
      let line = series.get(key);
      if (!line) {
        line = { dataKey: `series${series.size}`, provider: point.provider };
        series.set(key, line);
      }
      row[line.dataKey] = point.value;
    }
    return row;
  });
  return { series: [...series.values()], data: data.map(row => ({
    ...Object.fromEntries([...series.values()].map(line => [line.dataKey, null])), ...row,
  })) };
}
