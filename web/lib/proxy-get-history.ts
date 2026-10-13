import { loadProxyGetEntries, proxyGetWorkloadKey, summarizeProxyGet, type ProxyGetRecord, type ProxyGetStats } from "./proxy-get";

export type ProxyHistoryProvider = Pick<ProxyGetStats,
  "provider" | "displayName" | "attempts" | "successes" | "medianGetMs" | "medianFirstByteMs" | "costPerSuccessUsd"> & { workloadKey: string };

export interface ProxyHistoryDay {
  date: string;
  compatible: boolean;
  providers: ProxyHistoryProvider[];
}

export function summarizeProxyGetHistory(entries: ProxyGetRecord[], country: string, requestedDate?: string) {
  // Assign an entire provider suite to its final UTC day. A midnight crossing
  // must not split ten attempts into two partial daily measurements.
  const suites = new Map<string, ProxyGetRecord[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.provider, entry.run_id]);
    const records = suites.get(key) ?? [];
    records.push(entry);
    suites.set(key, records);
  }
  const byDate = new Map<string, ProxyGetRecord[]>();
  const latestRecord = (records: ProxyGetRecord[]) => records.reduce((a, b) => a.created_at > b.created_at ? a : b);
  for (const records of suites.values()) {
    const date = latestRecord(records).created_at.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), ...records]);
  }
  const dates = [...byDate.keys()].sort();
  const selectedDate = requestedDate && dates.includes(requestedDate) ? requestedDate : dates.at(-1) ?? null;
  const selectedEntries = selectedDate ? byDate.get(selectedDate)! : [];
  const selected = summarizeProxyGet(selectedEntries, country);
  // The overview keeps each provider's latest suite up to the inspected day.
  // Summarize providers separately: a changed target must not hide older rows
  // or pool samples from different workloads into one provider measurement.
  const overviewEntries = new Map<string, ProxyGetRecord[]>();
  for (const [date, records] of byDate) {
    if (!selectedDate || date > selectedDate) continue;
    for (const record of records) {
      const group = overviewEntries.get(record.provider) ?? [];
      group.push(record);
      overviewEntries.set(record.provider, group);
    }
  }
  const overviewProviders = [...overviewEntries.values()].flatMap(records => summarizeProxyGet(records, country).providers);
  overviewProviders.sort((a, b) => (a.medianGetMs ?? Infinity) - (b.medianGetMs ?? Infinity) || a.displayName.localeCompare(b.displayName));
  const overviewWorkloads = new Set(overviewProviders.flatMap(p => p.samples.map(proxyGetWorkloadKey)));
  const overviewSample = overviewProviders[0]?.samples[0];
  const overview = { providers: overviewProviders, latestAt: selected.latestAt,
    workload: overviewWorkloads.size === 1 && overviewSample ? summarizeProxyGet([overviewSample], country).workload : null };
  // Retain each day's latest suite, including older workloads. The chart
  // separates workload segments instead of erasing their recorded history.
  const days: ProxyHistoryDay[] = [];
  const workloadChangeDates: string[] = [];
  const previousWorkloads = new Map<string, string>();
  // Calendar gaps become null points, so a missed daily run is not bridged.
  if (dates.length) {
    const end = Date.parse(`${dates.at(-1)}T00:00:00Z`);
    for (let at = Date.parse(`${dates[0]}T00:00:00Z`); at <= end; at += 86_400_000) {
      const date = new Date(at).toISOString().slice(0, 10);
      const records = byDate.get(date) ?? [];
      const byProvider = new Map<string, ProxyGetRecord[]>();
      for (const record of records) {
        const group = byProvider.get(record.provider) ?? [];
        group.push(record);
        byProvider.set(record.provider, group);
      }
      const providers = [...byProvider].flatMap(([provider, group]) => {
        // Providers first recorded after the selected day have no baseline yet.
        if (!overviewEntries.has(provider)) return [];
        return summarizeProxyGet(group, country).providers;
      });
      days.push({ date, compatible: providers.length > 0, providers: providers.map(p => {
        const workloadKey = proxyGetWorkloadKey(p.samples[0]);
        const previous = previousWorkloads.get(p.provider);
        if (previous !== undefined && previous !== workloadKey && !workloadChangeDates.includes(date)) workloadChangeDates.push(date);
        previousWorkloads.set(p.provider, workloadKey);
        return { provider: p.provider, displayName: p.displayName, attempts: p.attempts, successes: p.successes,
          medianGetMs: p.medianGetMs, medianFirstByteMs: p.medianFirstByteMs, costPerSuccessUsd: p.costPerSuccessUsd, workloadKey };
      }) });
    }
  }
  return { dates, days, selectedDate, selected, overview,
    workloadChangeDates };
}

export async function loadProxyGetHistory(country = "US", date?: string) {
  return summarizeProxyGetHistory(await loadProxyGetEntries(true), country, date);
}
