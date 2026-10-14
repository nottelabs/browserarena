"use client";

import { track, type Benchmark } from "@/lib/analytics";
import { PrefetchLinks, useBenchmarkNavigation } from "./benchmark-navigation";

const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function RunDatePicker({
  dates,
  selectedDate,
  benchmark,
  pathname,
  query = {},
}: {
  dates: string[];
  selectedDate: string;
  benchmark: Benchmark;
  pathname: string;
  query?: Record<string, string>;
}) {
  const { pending, navigate } = useBenchmarkNavigation();
  if (!selectedDate) return null;
  const options = [...new Set(dates.length ? dates : [selectedDate])].sort().reverse();
  if (options.length < 2) return <span data-run-date="">{formatDate(selectedDate)}</span>;
  const hrefs = options.filter((date) => date !== selectedDate).slice(0, 8).map((date) => {
    const params = new URLSearchParams(query);
    params.set("date", date);
    return `${pathname}?${params}`;
  });
  return (
    <>
    <PrefetchLinks hrefs={hrefs} />
    <select
      aria-label="Run date"
      data-run-date=""
      disabled={pending}
      value={options.includes(selectedDate) ? selectedDate : options[0]}
      onChange={(event) => {
        const params = new URLSearchParams(query);
        params.set("date", event.target.value);
        track("run_day_selected", { benchmark, date: event.target.value });
        navigate(`${pathname}?${params}`);
      }}
    >
      {options.map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}
    </select>
    </>
  );
}
