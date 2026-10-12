import fs from "node:fs";
import path from "node:path";

/** A resumed suite keeps its original file even when UTC midnight has passed. */
export function proxySuiteOutput(provider: string, runId: string, date: string, resultsRoot = "results") {
  const base = path.join(resultsRoot, "proxy-get", provider);
  const matches: string[] = [];
  if (fs.existsSync(base)) {
    for (const day of fs.readdirSync(base, { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
      const file = path.join(base, day.name, "results.jsonl");
      if (!fs.existsSync(file)) continue;
      const found = fs.readFileSync(file, "utf8").split("\n").filter(line => line.trim())
        .some(line => JSON.parse(line).run_id === runId);
      if (found) matches.push(file);
    }
  }
  if (matches.length > 1) {
    throw new Error(`Suite ${runId} for ${provider} is split across multiple files; reconcile saved attempts before resuming`);
  }
  return matches[0] ?? path.join(base, date, "results.jsonl");
}
