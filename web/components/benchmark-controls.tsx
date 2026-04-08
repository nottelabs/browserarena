"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

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

export function HelloBrowserControls({
  concurrencyLevels,
}: {
  concurrencyLevels?: number[];
}) {
  const searchParams = useSearchParams();
  const concurrency = searchParams.get("concurrency") || "";
  const defaultConcurrency = concurrencyLevels?.[0] ?? 1;
  const effectiveConcurrency = Number(concurrency || String(defaultConcurrency));

  const options = (concurrencyLevels && concurrencyLevels.length > 1)
    ? concurrencyLevels
    : [1];

  if (options.length <= 1) return null;

  return (
    <div className="hidden sm:flex flex-col gap-1.5">
      <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-foreground">
        Benchmark
      </span>
      <div className="flex items-center gap-2">
        {options.map((c) => {
          const isActive = effectiveConcurrency === c;
          const label = c === 1 ? "Sequential Runs" : `Concurrent Runs`;
          const params = buildSearchParams(searchParams, {
            concurrency: c === defaultConcurrency ? "" : String(c),
          });
          return (
            <Link
              key={c}
              href={`/?${params}`}
              scroll={false}
              className={`rounded-[3px] border px-5 py-2 text-[0.78rem] font-medium transition-colors ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/25 bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          );
        })}
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
