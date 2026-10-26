import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Real timeout, flock, Git, and publication; only SDK calls and installation
// are replaced. Never create paid sessions or contact a remote Git server.
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "provider-publish-"));
  const repo = path.join(base, "repo");
  const bin = path.join(base, "bin");
  const remote = path.join(base, "remote.git");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.mkdirSync(bin);
  fs.copyFileSync("scripts/run-and-publish.sh", path.join(repo, "scripts/run-and-publish.sh"));
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, ".gitignore"), "logs/\n.env\ndist/\n.run-and-publish.lock\n");
  fs.writeFileSync(path.join(repo, "package.json"), '{"type":"module"}\n');
  git("add", ".");
  git("commit", "-m", "Initial");
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  fs.writeFileSync(path.join(repo, ".env"), "NOTTE_API_KEY=test-only\nSTEEL_API_KEY=test-only\n");
  fs.writeFileSync(path.join(repo, "unrelated-private.txt"), "must not publish\n");

  fs.mkdirSync(path.join(repo, "dist"));
  const provider = path.join(repo, "dist/cli.js");
  fs.writeFileSync(provider, `
import fs from "node:fs";
import { spawn } from "node:child_process";
const args = Object.fromEntries(process.argv.slice(2).filter(x => x.startsWith("--")).map(x => x.slice(2).split("=")));
const p = args.provider;
fs.appendFileSync("logs/calls.jsonl", JSON.stringify(args) + "\\n");
const dir = "results/" + args.benchmark + "/" + p + "/" + args["run-date"];
fs.mkdirSync(dir + "/c1", { recursive: true });
fs.writeFileSync(dir + "/_meta.json", JSON.stringify({ started_at: new Date().toISOString(), finished_at: "" }));
fs.appendFileSync(dir + "/c1/results.jsonl", JSON.stringify({ provider: p, success: true }) + "\\n");
if (p === process.env.STUCK_PROVIDER) {
  if (process.env.CORRUPT_META === "1") fs.writeFileSync(dir + "/_meta.json", "{");
  if (process.env.IGNORE_TERM === "1") {
    process.on("SIGTERM", () => {});
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "ignore" });
    fs.writeFileSync("logs/child.pid", String(child.pid));
  }
  setInterval(() => {}, 1000);
} else if (p === process.env.FAILED_PROVIDER) {
  process.exit(42);
} else {
  const meta = JSON.parse(fs.readFileSync(dir + "/_meta.json", "utf8"));
  meta.finished_at = new Date().toISOString();
  fs.writeFileSync(dir + "/_meta.json", JSON.stringify(meta));
}
`);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> logs/npm.log\n", { mode: 0o755 });

  const run = (args: string[] = [], extra: Record<string, string> = {}) => spawnSync(
    "bash", ["scripts/run-and-publish.sh", "--region", "us-west", ...args], {
      cwd: repo, encoding: "utf8", timeout: 45_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extra },
    }
  );
  const calls = () => fs.readFileSync(path.join(repo, "logs/calls.jsonl"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));
  const meta = (p: string) => JSON.parse(git("show",
    `origin/main:results/${calls()[0].benchmark}/${p}/${calls()[0]["run-date"]}/_meta.json`));
  const checkPublication = () => {
    assert.equal(git("rev-parse", "HEAD"), git("rev-parse", "origin/main"));
    const paths = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split("\n");
    assert.ok(paths.length > 0);
    assert.ok(paths.every(p => p.startsWith(`results/${calls()[0].benchmark}/`)));
    assert.throws(() => git("show", "origin/main:unrelated-private.txt"));
    // No descendant may keep the shared checkout locked after a timeout.
    execFileSync("flock", ["-n", path.join(repo, ".run-and-publish.lock"), "true"]);
  };
  return { repo, git, run, calls, meta, checkPublication, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("hung provider is terminated; later providers publish and cron reports failure", () => {
  const f = fixture();
  try {
    const result = f.run(["--provider-timeout", "1"], { STUCK_PROVIDER: "notte" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /provider=notte outcome=timed_out/);
    assert.deepEqual(f.calls().map(c => c.provider), ["notte", "lightpanda", "browserless"]);
    assert.equal(new Set(f.calls().map(c => c["run-date"])).size, 1);
    assert.equal(f.meta("notte").run_status, "timed_out");
    assert.equal(f.meta("notte").process_exit_code, 124);
    assert.ok(f.meta("notte").finished_at);
    assert.ok(f.meta("browserless").finished_at);
    assert.equal(fs.readFileSync(path.join(f.repo, "logs/npm.log"), "utf8"), "ci\nrun build\n");
    f.checkPublication();
  } finally { f.cleanup(); }
});

test("SIGKILL stops a provider and its child when both ignore SIGTERM", { timeout: 45_000 }, () => {
  const f = fixture();
  try {
    const result = f.run(["--provider-timeout=1"], { STUCK_PROVIDER: "notte", IGNORE_TERM: "1" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(f.meta("notte").run_status, "killed");
    assert.equal(f.meta("notte").process_exit_code, 137);
    assert.deepEqual(f.calls().map(c => c.provider), ["notte", "lightpanda", "browserless"]);
    const pid = Number(fs.readFileSync(path.join(f.repo, "logs/child.pid"), "utf8"));
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      assert.match(stat.slice(stat.lastIndexOf(")") + 2), /^[ZX]/, "provider child must be dead");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    f.checkPublication();
  } finally { f.cleanup(); }
});

test("ordinary provider errors do not stop the campaign or publication", () => {
  const f = fixture();
  try {
    const result = f.run([], { FAILED_PROVIDER: "lightpanda" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /provider_timeout=1800s/);
    assert.match(result.stdout, /provider=lightpanda outcome=failed exit=42/);
    assert.equal(f.meta("lightpanda").run_status, "failed");
    assert.equal(f.meta("lightpanda").process_exit_code, 42);
    assert.ok(f.meta("browserless").finished_at);
    f.checkPublication();
  } finally { f.cleanup(); }
});

test("a timeout during a metadata write does not stop later providers", () => {
  const f = fixture();
  try {
    const result = f.run(["--provider-timeout", "1"], { STUCK_PROVIDER: "notte", CORRUPT_META: "1" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(f.meta("notte").run_status, "timed_out");
    assert.ok(f.meta("browserless").finished_at);
    f.checkPublication();
  } finally { f.cleanup(); }
});

test("successful throughput campaign uses the longer default and exits zero", () => {
  const f = fixture();
  try {
    const result = f.run(["--benchmark", "browser-throughput", "--concurrency", "1", "--loops", "5"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /provider_timeout=3600s/);
    assert.ok(f.calls().every(c => c.benchmark === "browser-throughput" && c.concurrency === "1" && c.loops === "5" && c.articles === "fixed"));
    f.checkPublication();
  } finally { f.cleanup(); }
});

test("same-day rerun commits tracked results before rebasing", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 2; i++) {
      const result = f.run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      f.checkPublication();
    }
    const c = f.calls()[0];
    const samples = f.git("show", `origin/main:results/hello-browser/notte/${c["run-date"]}/c1/results.jsonl`);
    assert.equal(samples.trim().split("\n").length, 2);
  } finally { f.cleanup(); }
});

test("invalid deadlines are rejected before installation or benchmarks", () => {
  const f = fixture();
  try {
    for (const value of ["0", "-1", "1.5", "abc"]) {
      const result = f.run(["--provider-timeout", value]);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /--provider-timeout must be a positive integer/);
    }
    assert.equal(fs.existsSync(path.join(f.repo, "logs")), false);
  } finally { f.cleanup(); }
});
