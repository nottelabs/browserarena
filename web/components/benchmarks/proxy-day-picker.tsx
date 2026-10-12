"use client";
import { track } from "@/lib/analytics";

import { useBenchmarkNavigation } from "./benchmark-navigation";

export function ProxyDayPicker({ dates, selectedDate, country, simulated, basePath = "/test-compressed", sort }: { dates: string[]; selectedDate: string; country: string; simulated: boolean; basePath?: string; sort?: string }) {
  const { pending, navigate } = useBenchmarkNavigation();
  return <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">Run day
    <select aria-label="Run day" disabled={pending} value={selectedDate} className="rounded-[3px] border border-foreground/25 bg-background px-3 py-1.5 text-foreground" onChange={e => {
      const query = new URLSearchParams({ country, date: e.target.value });
      if (basePath !== "/proxy-get") query.set("demo", simulated ? "1" : "0");
      if (sort === "cost") query.set("sort", "cost");
      track("run_day_selected", { benchmark: "proxy-performance", date: e.target.value });
      navigate(`${basePath}?${query}`);
    }}>
      {[...dates].reverse().map(date => <option key={date} value={date}>{new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</option>)}
    </select>
  </label>;
}
