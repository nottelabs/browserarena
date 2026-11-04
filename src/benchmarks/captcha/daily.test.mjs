import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS } from "./protocol.mjs";

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
  // A push is refused while this file exists.
  const reject = path.join(root, "reject");
  fs.writeFileSync(path.join(origin, "hooks/pre-receive"), `#!/bin/sh\n[ -e "${reject}" ] && exit 1\nexit 0\n`, { mode: 0o755 });
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
if (process.env.FAKE_CLI_HANG) { fs.writeFileSync(process.env.FAKE_CLI_HANG, "started"); setTimeout(() => {}, 4000); }
else process.exit(Number(process.env.FAKE_CLI_EXIT ?? 0));
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
  const environment = env => ({ ...process.env, ...identity, FAKE_CALLS: calls, CAPTCHA_PUSH_RETRY_DELAY: "0",
    BROWSERARENA_COMPARISON_LOCK: path.join(root, "comparison.lock"), ...env });
  const args = (extra, reset) => ["scripts/run-captcha-and-publish.sh", ...(reset ? [] : ["--no-reset"]), "--no-install", `--date=${DATE}`, ...extra];
  return {
    root, origin, work, calls, reject,
    run: (extra = [], env = {}, { reset = false } = {}) => spawnSync("bash", args(extra, reset), { cwd: work, encoding: "utf8", env: environment(env) }),
    start: (extra = [], env = {}) => spawn("bash", args(extra, false), { cwd: work, env: environment(env), detached: true, stdio: "ignore" }),
    cliCalls: () => fs.readFileSync(calls, "utf8").split("\n").filter(Boolean),
    published: () => git(root, "--git-dir", origin, "ls-tree", "-r", "--name-only", "main").split("\n"),
  };
}

test("daily CAPTCHA run exports a complete campaign and pushes only that file to main", t => {
  const { origin, cliCalls, run, published } = setup(t);
  const result = run(["--runs=2"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(cliCalls()[0], /--benchmark=captcha --provider=\S+ --runs=2 --concurrency=3 --out=\.captcha-runs\/daily-2026-11-05-/);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(git(origin, "log", "-1", "--format=%s", "main").trim(), `results: captcha us-west ${DATE}`);
});

test("daily CAPTCHA run does not pay for a campaign that is already published", t => {
  const { cliCalls, run } = setup(t);
  assert.equal(run().status, 0);
  const again = run();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(cliCalls().length, 1);
});

test("the campaign always covers every provider, whatever the runner environment sets", t => {
  const { cliCalls, run } = setup(t);
  const result = run([], { PROVIDER: "notte", RUNS: "1", CONCURRENCY: "1", OUTPUT: "/tmp/elsewhere" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(cliCalls()[0].includes(`--provider=${PROVIDERS.join(",")}`), cliCalls()[0]);
  assert.match(cliCalls()[0], /--runs=5 --concurrency=3 --out=\.captcha-runs\//);
});

test("a failed campaign is held for review, publishes nothing and blocks the next run", t => {
  const { work, cliCalls, run, published } = setup(t);
  const failed = run([], { FAKE_CLI_EXIT: "3" });
  assert.equal(failed.status, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.match(fs.readFileSync(path.join(work, ".captcha-runs/needs-review"), "utf8"), /status 3/);
  const blocked = run();
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout + blocked.stderr, /needs-review exists/);
  assert.equal(cliCalls().length, 1);
});

test("a publisher killed mid-campaign still blocks the next run", async t => {
  const { root, work, cliCalls, run, start, published } = setup(t);
  const started = path.join(root, "started");
  const child = start([], { FAKE_CLI_HANG: started });
  for (let waited = 0; !fs.existsSync(started); waited += 50) {
    assert.ok(waited < 15000, "the fake campaign never started");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  process.kill(-child.pid, "SIGKILL");
  await once(child, "exit");
  assert.match(fs.readFileSync(path.join(work, ".captcha-runs/needs-review"), "utf8"), /did not finish/);
  const blocked = run();
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout + blocked.stderr, /needs-review exists/);
  assert.equal(cliCalls().length, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
});

test("an incomplete campaign is never published and is held for review", t => {
  const { work, run, published } = setup(t);
  const result = run([], { FAKE_COMPLETE: "false" });
  assert.equal(result.status, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.ok(!fs.existsSync(path.join(work, `results/captcha/${ID}.json`)));
  assert.match(fs.readFileSync(path.join(work, ".captcha-runs/needs-review"), "utf8"), /not complete/);
});

test("unrelated staged changes are refused before any campaign runs", t => {
  const { work, cliCalls, run, published } = setup(t);
  fs.writeFileSync(path.join(work, "unrelated.txt"), "not a result\n");
  git(work, "add", "unrelated.txt");
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /clean index/);
  assert.equal(cliCalls().length, 0);
  assert.ok(!published().includes("unrelated.txt"));
});

test("a result whose push failed is pushed by the next run instead of being reset away", t => {
  const { work, reject, cliCalls, run, published } = setup(t);
  fs.writeFileSync(reject, "");
  const failed = run();
  assert.equal(failed.status, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.match(git(work, "log", "origin/main..HEAD", "--format=%s"), /results: captcha us-west/);
  fs.unlinkSync(reject);
  // A normal run resets the checkout; it must publish the pending result first
  // and must not pay for the same day's campaign again.
  const recovered = run([], {}, { reset: true });
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(cliCalls().length, 1);
});

test("a dry run leaves a pending result unpushed, in place, and runs no campaign", t => {
  const { work, origin, reject, cliCalls, run, published } = setup(t);
  fs.writeFileSync(reject, "");
  assert.equal(run().status, 1);
  fs.unlinkSync(reject);
  const before = git(origin, "rev-parse", "main").trim();
  const dry = run(["--dry-run"], {}, { reset: true });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout + dry.stderr, /--dry-run: 1 commit/);
  assert.equal(git(origin, "rev-parse", "main").trim(), before);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.match(git(work, "log", "origin/main..HEAD", "--format=%s"), /results: captcha us-west/);
  assert.equal(cliCalls().length, 1);
});

test("local commits that are not CAPTCHA results are never pushed or reset away", t => {
  const { work, cliCalls, run, published } = setup(t);
  fs.writeFileSync(path.join(work, "notes.txt"), "someone's work\n");
  git(work, "add", "notes.txt");
  git(work, "commit", "-m", "local work");
  const result = run([], {}, { reset: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /touch files other than CAPTCHA results/);
  assert.equal(cliCalls().length, 0);
  assert.ok(!published().includes("notes.txt"));
  assert.equal(git(work, "log", "-1", "--format=%s").trim(), "local work");
});

test("daily CAPTCHA run rejects out-of-range options before doing any work", t => {
  const { cliCalls, run } = setup(t);
  for (const args of [["--runs=0"], ["--runs=21"], ["--runs=x"], ["--timeout=0"], ["--date=today"], ["--nope"]])
    assert.notEqual(run(args).status, 0, args.join(" "));
  assert.equal(cliCalls().length, 0);
});
