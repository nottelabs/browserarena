import type { ProxyHistoryDay } from "./proxy-get-history";

export type ProxyHistoryMetric = "medianGetMs" | "medianFirstByteMs" | "costPerSuccessUsd";

/** Equal-weight average of daily summaries in a trailing calendar-day window. */
export function proxyRollingAverage(days: ProxyHistoryDay[], metric: ProxyHistoryMetric, windowDays = 7) {
  return days.map(day => {
    const start = new Date(`${day.date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - windowDays + 1);
    const lower = start.toISOString().slice(0, 10);
    const window = days.filter(d => d.date >= lower && d.date <= day.date);
    return { date: day.date, providers: day.providers.map(provider => {
      const values = window.flatMap(d => {
        const value = d.providers.find(p => p.provider === provider.provider)?.[metric];
        return typeof value === "number" ? [value] : [];
      });
      // A missing current measurement remains a gap rather than a carried value.
      return { provider: provider.provider, value: provider[metric] === null || !values.length ? null : values.reduce((a, b) => a + b, 0) / values.length, count: values.length };
    }) };
  });
}
