/**
 * Writes web/.results-index.json: every hello-browser and browser-throughput
 * results file in this checkout, with the commit it belongs to. Deployed
 * functions do not bundle those files (next.config.ts) and use this index to
 * fetch them from GitHub at that commit; see lib/results-store.ts.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REMOTE_BENCHMARKS, RESULTS_INDEX_FILENAME, type ResultsIndex } from "../lib/results-store";

const webDir = path.resolve(import.meta.dirname, "..");
const resultsDir = path.resolve(webDir, "..", "results");

// Files the site reads. Logs are not committed; failure screenshots are only listed by path.
const INCLUDED = /(^|\/)(results\.jsonl|_meta\.json)$/;

function walk(relative: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(resultsDir, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "screenshots") walk(child, out);
    } else if (INCLUDED.test(child)) {
      out.push(child);
    }
  }
}

const files: string[] = [];
for (const benchmark of REMOTE_BENCHMARKS) {
  if (fs.existsSync(path.join(resultsDir, benchmark))) walk(benchmark, files);
}
files.sort();

const indexFile = path.join(webDir, RESULTS_INDEX_FILENAME);
if (files.length === 0) {
  // No results in this checkout: write no index, so loaders keep their GitHub fallback.
  fs.rmSync(indexFile, { force: true });
  console.log("[results-index] no lifecycle or throughput results; no index written");
  process.exit(0);
}

const commit = process.env.VERCEL_GIT_COMMIT_SHA
  || execFileSync("git", ["rev-parse", "HEAD"], { cwd: webDir, encoding: "utf-8" }).trim();
const repo = process.env.RESULTS_GITHUB_REPO
  || (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : "nottelabs/browserarena");

const index: ResultsIndex = { repo, commit, files };
fs.writeFileSync(indexFile, JSON.stringify(index) + "\n");
console.log(`[results-index] ${files.length} files at ${repo}@${commit.slice(0, 12)}`);
