import { loadProxyGetEntries, proxyGetWorkloadKey, summarizeProxyGet, type ProxyGetRecord, type ProxyGetStats } from "./proxy-get";

export type ProxyHistoryProvider = Pick<ProxyGetStats,
  "provider" | "displayName" | "attempts" | "successes" | "medianGetMs" | "medianFirstByteMs" | "costPerSuccessUsd">;

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
  // Compare each provider with its own latest workload as of the inspected day.
  // Another provider running against a new target must not erase its history.
  const providerWorkloads = new Map([...overviewEntries].map(([provider, records]) =>
    [provider, proxyGetWorkloadKey(latestRecord(records))]));
  const days: ProxyHistoryDay[] = [];
  const incompatibleDates: string[] = [];
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
        const workload = providerWorkloads.get(provider);
        // Providers first recorded after the selected day have no baseline yet.
        if (workload === undefined) return [];
        if (proxyGetWorkloadKey(latestRecord(group)) !== workload) {
          if (!incompatibleDates.includes(date)) incompatibleDates.push(date);
          return [];
        }
        return summarizeProxyGet(group, country).providers;
      });
      days.push({ date, compatible: providers.length > 0, providers: providers.map(p => ({
        provider: p.provider, displayName: p.displayName, attempts: p.attempts, successes: p.successes,
        medianGetMs: p.medianGetMs, medianFirstByteMs: p.medianFirstByteMs, costPerSuccessUsd: p.costPerSuccessUsd,
      })) });
    }
  }
  return { dates, days, selectedDate, selected, overview,
    incompatibleDates };
}

export async function loadProxyGetHistory(country = "US", date?: string) {
  return summarizeProxyGetHistory(await loadProxyGetEntries(true), country, date);
}
