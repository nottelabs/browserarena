"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { PercentileType, SortByType } from "@/lib/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/nottelabs/browserarena";

function buildSearchParams(
  current: URLSearchParams,
  updates: Record<string, string>
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(updates)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  return next.toString();
}

export function BenchmarkControls({
  v0Dates,
}: {
  v0Dates: string[];
  dateRange?: { min: string; max: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const benchmark = searchParams.get("benchmark") || "hello-browser";
  const date = searchParams.get("date") || v0Dates[0] || "";
  const percentile = (searchParams.get("percentile") || "median") as PercentileType;
  const sortBy = (searchParams.get("sort") || "latency") as SortByType;

  const SORT_OPTIONS: { value: SortByType; label: string; available: boolean }[] = [
    { value: "latency", label: "Latency", available: true },
    { value: "reliability", label: "Reliability", available: true },
    { value: "price", label: "Price", available: true },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Benchmark tabs */}
      <div className="flex">
        <Link
          href={`/?${buildSearchParams(searchParams, { benchmark: "hello-browser", date: "" })}`}
          scroll={false}
          className={`px-4 py-2 text-[0.75rem] font-medium border-b-2 -mb-px ${benchmark === "hello-browser"
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
        >
          Hello Browser
        </Link>
        <Link
          href={`/?${buildSearchParams(searchParams, { benchmark: "v0", date: v0Dates[0] || "" })}`}
          scroll={false}
          className={`px-4 py-2 text-[0.75rem] font-medium border-b-2 -mb-px ${benchmark === "v0"
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
        >
          v0
        </Link>
      </div>

      {/* Secondary: date + percentile + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5">
          {SORT_OPTIONS.map((opt) =>
            opt.available ? (
              <Link
                key={opt.value}
                href={`/?${buildSearchParams(searchParams, { sort: opt.value })}`}
                scroll={false}
                className={`px-3 py-1.5 text-[0.7rem] font-medium rounded-sm ${sortBy === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {opt.label}
              </Link>
            ) : (
              <span
                key={opt.value}
                className="px-3 py-1.5 text-[0.7rem] text-muted-foreground/60 cursor-not-allowed"
                title="Coming soon"
              >
                {opt.label}
              </span>
            )
          )}
        </div>
        {sortBy === "latency" && (
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5">
            {(["median", "p90", "p95"] as const).map((p) => (
              <Link
                key={p}
                href={`/?${buildSearchParams(searchParams, { percentile: p })}`}
                scroll={false}
                className={`px-3 py-1.5 text-[0.7rem] font-medium rounded-sm ${percentile === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {p === "median" ? "Median" : p === "p90" ? "P90" : "P95"}
              </Link>
            ))}
          </div>
        )}
        {benchmark === "v0" && v0Dates.length > 0 && (
          <Select
            value={date}
            onValueChange={(value) => {
              const next = new URLSearchParams(searchParams);
              next.set("date", value);
              router.push(`/?${next.toString()}`, { scroll: false });
            }}
          >
            <SelectTrigger size="sm" className="w-[140px] text-[0.7rem]">
              <SelectValue placeholder="Select date" />
            </SelectTrigger>
            <SelectContent>
              {v0Dates.map((d) => (
                <SelectItem key={d} value={d} className="text-[0.7rem]">
                  {formatDate(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function GitHubLink() {
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground"
      aria-label="View source on GitHub"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-5">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </a>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
