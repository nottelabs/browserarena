import fs from "node:fs";
import path from "node:path";
import type { ProxyGetRecord } from "./schema.js";

function parseRow(line: string): ProxyGetRecord {
  const row = JSON.parse(line);
  if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.run_id !== "string") {
    throw new Error("Missing suite ID");
  }
  return row;
}

function damagedHistory(file: string, line: number) {
  return new Error(`Damaged proxy history at ${file}:${line}; restore or reconcile saved attempts before resuming or appending to this file`);
}

/** Never ignore damaged attempts in the file that will receive new results. */
export function readProxyResults(file: string): ProxyGetRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [parseRow(line)]; }
    catch { throw damagedHistory(file, index + 1); }
  });
}

// A complete ID can survive an interrupted JSONL append. This is only a
// conservative recovery guard, never a replacement for a saved attempt.
function partialRunId(line: string): string | undefined {
  const match = line.match(/"run_id"\s*:\s*("(?:[^"\\]|\\.)*")/);
  try { return match ? JSON.parse(match[1]!) : undefined; }
  catch { return undefined; }
}

/** A resumed suite keeps its original file even when UTC midnight has passed. */
export function proxySuiteOutput(provider: string, runId: string, date: string, resultsRoot = "results") {
  const base = path.join(resultsRoot, "proxy-get", provider);
  const matches: string[] = [];
  if (fs.existsSync(base)) {
    for (const day of fs.readdirSync(base, { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
      const file = path.join(base, day.name, "results.jsonl");
      if (!fs.existsSync(file)) continue;
      let found = false;
      let damagedLine = 0;
      for (const [index, line] of fs.readFileSync(file, "utf8").split("\n").entries()) {
        if (!line.trim()) continue;
        try { if (parseRow(line).run_id === runId) found = true; }
        catch {
          damagedLine ||= index + 1;
          if (partialRunId(line) === runId) found = true;
        }
      }
      if (damagedLine) {
        const meta = path.join(base, day.name, "_meta.json");
        if (fs.existsSync(meta)) {
          const content = fs.readFileSync(meta, "utf8");
          if (partialRunId(content) === runId) found = true;
        }
        if (found) throw damagedHistory(file, damagedLine);
        console.error(`[PROXY_GET_HISTORY_WARNING] Damaged history at ${file}:${damagedLine}; preserved unchanged. Reconcile this file before resuming its suites.`);
      }
      if (found) matches.push(file);
    }
  }
  if (matches.length > 1) {
    throw new Error(`Suite ${runId} for ${provider} is split across multiple files; reconcile saved attempts before resuming`);
  }
  return matches[0] ?? path.join(base, date, "results.jsonl");
}
