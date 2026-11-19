/**
 * Which run-days a push added, so an edge alert is posted once per run-day.
 *
 * The regression workflow runs on every push under results/, several times a
 * day (proxy-get batches, throughput runs, the second region). The open/close
 * decision only compares the latest run-day with the one before it, so without
 * this every later push of the same day posted the same event again.
 */

const RESULTS_FILE = /^results\/hello-browser\/[^/]+\/(\d{4}-\d{2}-\d{2})\/c(\d+)\/results\.jsonl$/;

export function runDayKey(provider: string, date: string, concurrency: number): string {
  return `${provider}|${date}|c${concurrency}`;
}

/**
 * The run-days, as `runDayKey`s, of the hello-browser result files a push
 * changed. The provider comes from the file's first entry, since result
 * directory names are not provider ids.
 *
 * `changedFiles` is newline separated, repository relative. `firstLine` returns
 * a file's first non-empty line, or null when the push deleted it.
 */
export function newRunDays(
  changedFiles: string,
  firstLine: (path: string) => string | null
): Set<string> {
  const days = new Set<string>();
  for (const path of changedFiles.split("\n").map((p) => p.trim())) {
    const match = RESULTS_FILE.exec(path);
    if (!match) continue;
    const line = firstLine(path);
    if (!line) continue;
    let provider: unknown;
    try {
      provider = (JSON.parse(line) as { provider?: unknown }).provider;
    } catch {
      continue;
    }
    if (typeof provider === "string" && provider) {
      days.add(runDayKey(provider, match[1], Number(match[2])));
    }
  }
  return days;
}
