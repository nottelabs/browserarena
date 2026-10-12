import fs from "node:fs";
import path from "node:path";

/** Raw-GitHub discovery avoids the unauthenticated Contents API rate limit. */
export function writeProxyResultsIndex(resultsRoot = "results") {
  const base = path.join(resultsRoot, "proxy-get");
  fs.mkdirSync(base, { recursive: true });
  const providers = fs.readdirSync(base, { withFileTypes: true })
    .filter(p => p.isDirectory() && /^[a-z0-9-]+$/.test(p.name))
    .map(p => ({ name: p.name, dates: fs.readdirSync(path.join(base, p.name), { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)
        && fs.existsSync(path.join(base, p.name, d.name, "results.jsonl")))
      .map(d => d.name).sort() }))
    .filter(p => p.dates.length).sort((a, b) => a.name.localeCompare(b.name));
  const file = path.join(base, "index.json");
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, providers }, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}
