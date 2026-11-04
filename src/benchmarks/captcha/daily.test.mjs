import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/run-captcha-and-publish.sh");
const DATE = "2026-11-05";
const ID = `${DATE}-west-v3`;
const identity = { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...identity }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A checkout shaped like the runner's, with a local bare origin and a fake
// campaign CLI and exporter, so the real script runs end to end without sessions.
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "captcha-daily-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  git(root, "init", "--bare", "-b", "main", origin);
  git(root, "clone", origin, work);
  fs.mkdirSync(path.join(work, "scripts"));
  fs.mkdirSync(path.join(work, "dist"));
  fs.copyFileSync(script, path.join(work, "scripts/run-captcha-and-publish.sh"));
  fs.writeFileSync(path.join(work, ".gitignore"), "logs/\n.captcha-runs/\n.run-and-publish.lock\n");
  fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ scripts: { "captcha:export": "node fake-export.mjs" } }));
  fs.writeFileSync(path.join(work, "dist/cli.js"), `
import fs from "node:fs";
fs.appendFileSync(process.env.FAKE_CALLS, "cli " + process.argv.slice(2).join(" ") + "\\n");
const out = process.argv.find(arg => arg.startsWith("--out=")).slice(6);
fs.mkdirSync(out, { recursive: true });
process.exit(Number(process.env.FAKE_CLI_EXIT ?? 0));
`);
  fs.writeFileSync(path.join(work, "fake-export.mjs"), `
import fs from "node:fs";
import path from "node:path";
const [, id] = process.argv.slice(2);
fs.mkdirSync("results/captcha", { recursive: true });
fs.writeFileSync(path.join("results/captcha", id + ".json"),
  JSON.stringify({ id, complete: process.env.FAKE_COMPLETE !== "false", halted: false, interrupted: false }) + "\\n", { flag: "wx" });
`);
  git(work, "add", ".");
  git(work, "commit", "-m", "base");
  git(work, "push", "origin", "main");
  const calls = path.join(root, "calls.log");
  fs.writeFileSync(calls, "");
  const run = (extra = [], env = {}) => spawnSync("bash", ["scripts/run-captcha-and-publish.sh", "--no-reset", "--no-install", `--date=${DATE}`, ...extra], {
    cwd: work, encoding: "utf8",
    env: { ...process.env, ...identity, FAKE_CALLS: calls, BROWSERARENA_COMPARISON_LOCK: path.join(root, "comparison.lock"), ...env },
  });
  return { origin, work, calls, run, published: () => git(root, "--git-dir", origin, "ls-tree", "-r", "--name-only", "main").split("\n") };
}

test("daily CAPTCHA run exports a complete campaign and pushes only that file to main", t => {
  const { origin, calls, run, published } = setup(t);
  const result = run(["--runs=2"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(fs.readFileSync(calls, "utf8"), /--benchmark=captcha --runs=2 --concurrency=3 --out=\.captcha-runs\/daily-2026-11-05-/);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(git(origin, "log", "-1", "--format=%s", "main").trim(), `results: captcha us-west ${DATE}`);
});

test("daily CAPTCHA run does not pay for a campaign that is already published", t => {
  const { calls, run } = setup(t);
  assert.equal(run().status, 0);
  const again = run();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(fs.readFileSync(calls, "utf8").split("\n").filter(Boolean).length, 1);
});

test("a failed campaign is held for review, publishes nothing and blocks the next run", t => {
  const { work, calls, run, published } = setup(t);
  const failed = run([], { FAKE_CLI_EXIT: "3" });
  assert.equal(failed.status, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.match(fs.readFileSync(path.join(work, ".captcha-runs/needs-review"), "utf8"), /status 3/);
  const blocked = run();
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout + blocked.stderr, /needs-review exists/);
  assert.equal(fs.readFileSync(calls, "utf8").split("\n").filter(Boolean).length, 1);
});

test("an incomplete campaign is never published and is held for review", t => {
  const { work, run, published } = setup(t);
  const result = run([], { FAKE_COMPLETE: "false" });
  assert.equal(result.status, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.ok(!fs.existsSync(path.join(work, `results/captcha/${ID}.json`)));
  assert.match(fs.readFileSync(path.join(work, ".captcha-runs/needs-review"), "utf8"), /not complete/);
});

test("daily CAPTCHA run rejects out-of-range options before doing any work", t => {
  const { calls, run } = setup(t);
  for (const args of [["--runs=0"], ["--runs=21"], ["--runs=x"], ["--timeout=0"], ["--date=today"], ["--nope"]])
    assert.notEqual(run(args).status, 0, args.join(" "));
  assert.equal(fs.readFileSync(calls, "utf8"), "");
});
