/**
 * Writes web/.results-index.json: every hello-browser and browser-throughput
 * results file in this checkout, with the commit it belongs to. Deployed
 * functions do not bundle those files (next.config.ts) and use this index to
 * fetch them from GitHub at that commit; see lib/results-store.ts.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { RESULTS_INDEX_FILENAME, writeResultsIndex } from "../lib/results-store";

const webDir = path.resolve(import.meta.dirname, "..");
const repo = process.env.RESULTS_GITHUB_REPO
  || (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : "nottelabs/browserarena");
const commit = () => process.env.VERCEL_GIT_COMMIT_SHA
  || execFileSync("git", ["rev-parse", "HEAD"], { cwd: webDir, encoding: "utf-8" }).trim();

const index = writeResultsIndex(path.resolve(webDir, "..", "results"), path.join(webDir, RESULTS_INDEX_FILENAME), { repo, commit });
console.log(index
  ? `[results-index] ${index.files.length} files at ${index.repo}@${index.commit.slice(0, 12)}`
  : "[results-index] no lifecycle or throughput results; no index written");
