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
printf '{"version":1,"providers":[]}\\n' > results/proxy-get/index.json
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
