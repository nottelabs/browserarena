"use client";
import { track } from "@/lib/analytics";

import { PrefetchLinks, useBenchmarkNavigation } from "./benchmark-navigation";

export function ProxyDayPicker({ dates, selectedDate, country, simulated, basePath = "/test-compressed", sort }: { dates: string[]; selectedDate: string; country: string; simulated: boolean; basePath?: string; sort?: string }) {
  const { pending, navigate } = useBenchmarkNavigation();
  const hrefs = [...dates].sort().reverse().filter((date) => date !== selectedDate).slice(0, 8).map((date) => {
    const params = new URLSearchParams({ country, date });
    if (basePath !== "/proxies") params.set("demo", simulated ? "1" : "0");
    if (sort === "cost") params.set("sort", "cost");
    return `${basePath}?${params}`;
  });
  return <label className="inline-flex items-center">
    <PrefetchLinks hrefs={hrefs} />
    <select aria-label="Run date" data-run-date="" disabled={pending} value={selectedDate} onChange={e => {
      const query = new URLSearchParams({ country, date: e.target.value });
      if (basePath !== "/proxies") query.set("demo", simulated ? "1" : "0");
      if (sort === "cost") query.set("sort", "cost");
      track("run_day_selected", { benchmark: "proxy-performance", date: e.target.value });
      navigate(`${basePath}?${query}`);
    }}>
      {[...dates].reverse().map(date => <option key={date} value={date}>{new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</option>)}
    </select>
  </label>;
}
