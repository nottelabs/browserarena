import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("benchmark API fits Vercel's uncompressed function size limit", async () => {
  const tracePath = path.resolve(".next/server/app/api/benchmarks/route.js.nft.json");
  const trace: { files: string[] } = JSON.parse(await readFile(tracePath, "utf8"));
  const sizes = await Promise.all(trace.files.map(async (file) =>
    (await stat(path.resolve(path.dirname(tracePath), file))).size
  ));
  const megabytes = sizes.reduce((total, size) => total + size, 0) / 1024 / 1024;
  // Leave room below Vercel's 250 MB cap for its generated function wrapper.
  expect(megabytes, `Traced function files total ${megabytes.toFixed(2)} MB`).toBeLessThan(240);
});
