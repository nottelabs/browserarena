import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const APP_DIR = path.resolve(".next/server/app");

async function traces(dir = APP_DIR): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await traces(full));
    else if (entry.name.endsWith(".js.nft.json")) found.push(full);
  }
  return found;
}

async function tracedFiles(tracePath: string): Promise<string[]> {
  const trace: { files: string[] } = JSON.parse(await readFile(tracePath, "utf8"));
  return trace.files.map((file) => path.resolve(path.dirname(tracePath), file));
}

test("every function fits Vercel's uncompressed function size limit", async () => {
  for (const tracePath of await traces()) {
    const sizes = await Promise.all((await tracedFiles(tracePath)).map(async (file) => (await stat(file)).size));
    const megabytes = sizes.reduce((total, size) => total + size, 0) / 1024 / 1024;
    const route = path.relative(APP_DIR, tracePath);
    // Leave room below Vercel's 250 MB cap for its generated function wrapper.
    expect(megabytes, `${route}: traced function files total ${megabytes.toFixed(2)} MB`).toBeLessThan(240);
  }
});

test("functions fetch lifecycle and throughput results instead of bundling them", async () => {
  const resultsDir = path.resolve("..", "results");
  for (const tracePath of await traces()) {
    const bundled = (await tracedFiles(tracePath)).filter((file) =>
      file.startsWith(path.join(resultsDir, "hello-browser") + path.sep)
      || file.startsWith(path.join(resultsDir, "browser-throughput") + path.sep));
    expect(bundled, path.relative(APP_DIR, tracePath)).toEqual([]);
  }
  const benchmarksApi = await tracedFiles(path.join(APP_DIR, "api/benchmarks/route.js.nft.json"));
  expect(benchmarksApi).toContain(path.resolve(".results-index.json"));
});
