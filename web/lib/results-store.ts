/**
 * Reads `results/<benchmark>/...` for the benchmarks too large to bundle into
 * Vercel functions (hello-browser and browser-throughput, ~250 MB together;
 * Vercel caps a function at 250 MB).
 *
 * Locally, in CI and during the build, the files are on disk. In a deployed
 * function they are not: next.config.ts excludes them from the trace. There the
 * store lists files from the index written at build time
 * (scripts/write-results-index.ts) and fetches them from GitHub at the commit
 * that was built, so a deployment always reads the same data its build saw.
 */

import fs from "fs";
import path from "path";

export const REMOTE_BENCHMARKS = ["hello-browser", "browser-throughput"] as const;
export type RemoteBenchmark = (typeof REMOTE_BENCHMARKS)[number];

export const RESULTS_INDEX_FILENAME = ".results-index.json";

export interface ResultsIndex {
  repo: string;
  commit: string;
  /** Paths relative to `results/`, e.g. `hello-browser/notte/2026-11-22/c1/results.jsonl`. */
  files: string[];
}

export interface ResultsDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface ResultsStore {
  readonly kind: "fs" | "remote";
  /** Entries of a directory under `results/`, or [] when it does not exist. */
  list(relative: string): Promise<ResultsDirEntry[]>;
  /** A file under `results/`, or null when it does not exist. */
  read(relative: string): Promise<string | null>;
}

export function fsResultsStore(resultsDir: string): ResultsStore {
  return {
    kind: "fs",
    async list(relative) {
      const dir = path.join(resultsDir, relative);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
    async read(relative) {
      const file = path.join(resultsDir, relative);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
    },
  };
}

const REMOTE_FETCH_CONCURRENCY = 24;
const REMOTE_FETCH_ATTEMPTS = 3;

export function remoteResultsStore(index: ResultsIndex, fetchImpl: typeof fetch = fetch): ResultsStore {
  // Directory tree from the file list: dir -> child name -> isDirectory.
  const tree = new Map<string, Map<string, boolean>>();
  const files = new Set<string>();
  for (const file of index.files) {
    files.add(file);
    const parts = file.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const children = tree.get(dir) ?? new Map<string, boolean>();
      children.set(parts[i]!, i < parts.length - 1 || children.get(parts[i]!) === true);
      tree.set(dir, children);
    }
  }

  let active = 0;
  const waiting: (() => void)[] = [];
  async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= REMOTE_FETCH_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  async function fetchText(relative: string): Promise<string> {
    const url = `https://raw.githubusercontent.com/${index.repo}/${index.commit}/results/${relative}`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= REMOTE_FETCH_ATTEMPTS; attempt++) {
      try {
        // A commit's files never change, so any cached copy is current.
        const res = await fetchImpl(url, { cache: "force-cache" });
        if (res.ok) return await res.text();
        lastError = new Error(`GET ${url}: ${res.status}`);
        // The index says the file exists at this commit; only server errors are worth retrying.
        if (res.status < 500) break;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  const normalize = (relative: string) => relative.split("/").filter(Boolean).join("/");

  return {
    kind: "remote",
    async list(relative) {
      const children = tree.get(normalize(relative));
      if (!children) return [];
      return [...children].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
    async read(relative) {
      const key = normalize(relative);
      if (!files.has(key)) return null;
      return limited(() => fetchText(key));
    },
  };
}

let cachedIndex: ResultsIndex | null | undefined;

function loadIndex(): ResultsIndex | null {
  if (cachedIndex !== undefined) return cachedIndex;
  const file = path.join(process.cwd(), RESULTS_INDEX_FILENAME);
  const index = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as ResultsIndex) : null;
  // An empty index would hide every result; without one, loaders fall back to GitHub's API.
  cachedIndex = index && index.files.length > 0 ? index : null;
  return cachedIndex;
}

let remoteStore: ResultsStore | undefined;

/**
 * The store for a benchmark: its files on disk when present, otherwise the
 * build's index and GitHub. Null when neither exists (a checkout without
 * results that was never built); callers then keep their GitHub fallback.
 */
export function resultsStoreFor(benchmark: RemoteBenchmark, resultsDir: string): ResultsStore | null {
  if (fs.existsSync(path.join(resultsDir, benchmark))) return fsResultsStore(resultsDir);
  const index = loadIndex();
  if (!index) return null;
  remoteStore ??= remoteResultsStore(index);
  return remoteStore;
}
