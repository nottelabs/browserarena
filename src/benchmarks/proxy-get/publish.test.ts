import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-publish-"));
  const repo = path.join(base, "repo");
  const remote = path.join(base, "remote.git");
  const bin = path.join(base, "bin");
  fs.mkdirSync(repo); fs.mkdirSync(bin); fs.mkdirSync(path.join(repo, "scripts"));
  fs.copyFileSync("scripts/run-proxy-and-publish.sh", path.join(repo, "scripts/run-proxy-and-publish.sh"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--bare", remote); git("init", "-b", "main");
  git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, ".gitignore"), "logs/\n.env\n");
  git("add", "."); git("commit", "-m", "Initial"); git("remote", "add", "origin", remote); git("push", "origin", "main");
  fs.writeFileSync(path.join(repo, ".env"), "DUMMY_PRIVATE_VALUE=test-only\n");
  fs.writeFileSync(path.join(repo, "unrelated-private.txt"), "must not publish\n");
  const fake = (name: string, source: string) => fs.writeFileSync(path.join(bin, name), source, { mode: 0o755 });
  // Only stub installation, provider calls, and macOS's missing flock. All Git
  // operations exercise real commits, rebases, and a local bare remote.
  fake("npm", "#!/bin/sh\nexit 0\n");
  fake("flock", "#!/bin/sh\nexit 0\n");
  fake("node", `#!/bin/bash
printf '%s\\n' "$*" >> logs/calls.log
if [[ "$*" == *--preflight* ]]; then exit "\${PREFLIGHT_STATUS:-0}"; fi
dir="results/proxy-get/steel/$(date -u +%Y-%m-%d)"
mkdir -p "$dir"
printf '{"test":true}\\n' > "$dir/results.jsonl"
printf '{}\\n' > "$dir/_meta.json"
'${process.execPath}' --input-type=module -e 'import fs from "node:fs";
const dates=fs.readdirSync("results/proxy-get/steel").filter(d=>/^\\d{4}-\\d{2}-\\d{2}$/.test(d)).sort();
fs.writeFileSync("results/proxy-get/index.json",JSON.stringify({version:1,providers:[{name:"steel",dates}]}));'
`);
  const run = (args: string[], extra: Record<string, string> = {}) => spawnSync("bash", ["scripts/run-proxy-and-publish.sh", ...args], {
    cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extra },
  });
  return { base, repo, git, run, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("failed proxy preflight creates no attempts or result commits", () => {
  const f = fixture();
  try {
    const before = f.git("rev-parse", "HEAD");
    const result = f.run(["--batch", "1"], { PREFLIGHT_STATUS: "1" });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(f.git("rev-parse", "HEAD"), before);
    assert.equal(fs.existsSync(path.join(f.repo, "results")), false);
    const calls = fs.readFileSync(path.join(f.repo, "logs/calls.log"), "utf8").trim().split("\n");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /--preflight/);
  } finally { f.cleanup(); }
});

test("proxy publisher pushes only result paths and blocks unrelated staged files", () => {
  const f = fixture();
  try {
    const result = f.run(["--batch", "5"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.git("rev-parse", "HEAD"), f.git("rev-parse", "origin/main"));
    const files = f.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split("\n");
    assert.equal(files.length, 3);
    assert.ok(files.every(file => file === "results/proxy-get/index.json"
      || /^results\/proxy-get\/steel\/\d{4}-\d{2}-\d{2}\/(results.jsonl|_meta.json)$/.test(file)));
    const calls = fs.readFileSync(path.join(f.repo, "logs/calls.log"), "utf8");
    assert.match(calls, /--runs=50/);
    f.git("add", "unrelated-private.txt");
    const rejected = f.run(["--batch", "5"]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout, /unrelated staged changes/);
    assert.equal(fs.readFileSync(path.join(f.repo, "logs/calls.log"), "utf8"), calls);
  } finally { f.cleanup(); }
});

test("old-day tracked and untracked recovery files are published with the index", () => {
  const f = fixture();
  try {
    const old = "results/proxy-get/steel/2020-01-01";
    const tracked = "results/proxy-get/steel/2020-01-02";
    for (const dir of [old, tracked]) {
      fs.mkdirSync(path.join(f.repo, dir), { recursive: true });
      fs.writeFileSync(path.join(f.repo, dir, "results.jsonl"), '{"saved":true}\n');
      fs.writeFileSync(path.join(f.repo, dir, "_meta.json"), "{}\n");
    }
    f.git("add", tracked); f.git("commit", "-m", "Previously published day"); f.git("push", "origin", "main");
    fs.appendFileSync(path.join(f.repo, tracked, "results.jsonl"), '{"interrupted":true}\n');
    const result = f.run(["--batch", "1"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.git("diff", "--name-only"), "", "no old tracked changes may block rebase");
    assert.equal(f.git("rev-parse", "HEAD"), f.git("rev-parse", "origin/main"));
    const index = JSON.parse(f.git("show", "origin/main:results/proxy-get/index.json"));
    for (const provider of index.providers) {
      for (const date of provider.dates) {
        assert.ok(f.git("show", `origin/main:results/proxy-get/${provider.name}/${date}/results.jsonl`));
      }
    }
    assert.match(f.git("show", `origin/main:${tracked}/results.jsonl`), /interrupted/);
    assert.match(f.git("show", `origin/main:${old}/results.jsonl`), /saved/);
    assert.throws(() => f.git("show", "origin/main:unrelated-private.txt"));
  } finally { f.cleanup(); }
});
