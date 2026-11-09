import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAILY_PROVIDERS, FIXTURES, PROTOCOL_VERSION } from "./protocol.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/run-captcha-and-publish.sh");
const DATE = "2026-11-05";
const ID = `${DATE}-west-v${PROTOCOL_VERSION}`;
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
if (process.env.FAKE_DOTENV_OUT) fs.writeFileSync(process.env.FAKE_DOTENV_OUT, process.env.FAKE_DOTENV ?? "");
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
  assert.ok(cliCalls()[0].includes(`--provider=${DAILY_PROVIDERS.join(",")} `), cliCalls()[0]);
  // The published ID names the protocol the campaign ran under.
  assert.match(fs.readFileSync(script, "utf8"), new RegExp(`^PROTOCOL=${PROTOCOL_VERSION}$`, "m"));
  assert.match(cliCalls()[0], /--runs=5 --concurrency=3 --out=\.captcha-runs\//);
});

test(".env reaches the campaign but cannot change the publisher's settings", t => {
  const { root, work, cliCalls, run, published } = setup(t);
  fs.writeFileSync(path.join(work, ".env"),
    "RUNS=1\nCONCURRENCY=1\nTIMEOUT=1\nPROTOCOL=9\nCAPTCHA_PROVIDERS=notte\nFAKE_DOTENV=from-dotenv\n");
  const probe = path.join(root, "dotenv-probe");
  const result = run([], { FAKE_DOTENV_OUT: probe });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(cliCalls()[0].includes(`--provider=${DAILY_PROVIDERS.join(",")} `), cliCalls()[0]);
  assert.match(cliCalls()[0], /--runs=5 --concurrency=3 --out=\.captcha-runs\//);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(fs.readFileSync(probe, "utf8"), "from-dotenv");
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

test("a result whose push failed survives another job resetting the shared checkout", t => {
  const { work, reject, cliCalls, run, published } = setup(t);
  fs.writeFileSync(reject, "");
  assert.equal(run().status, 1);
  fs.unlinkSync(reject);
  // The lifecycle publisher shares the checkout and resets it before its own run.
  git(work, "reset", "--hard", "origin/main");
  const recovered = run([], {}, { reset: true });
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(cliCalls().length, 1);
  assert.deepEqual(fs.readdirSync(path.join(work, ".captcha-runs/pending")), []);
});

test("a result whose push failed is still pushed after main gains other changes", t => {
  const { root, origin, reject, cliCalls, run, published } = setup(t);
  fs.writeFileSync(reject, "");
  assert.equal(run().status, 1);
  fs.unlinkSync(reject);
  const other = path.join(root, "other");
  git(root, "clone", origin, other);
  fs.writeFileSync(path.join(other, "lifecycle.txt"), "another job's result\n");
  git(other, "add", "lifecycle.txt");
  git(other, "commit", "-m", "results: lifecycle");
  git(other, "push", "origin", "main");
  const recovered = run([], {}, { reset: true });
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.ok(published().includes("lifecycle.txt"));
  assert.equal(cliCalls().length, 1);
});

// What the publisher leaves behind if it stops between export and commit.
function leaveExport(work, id, complete) {
  fs.mkdirSync(path.join(work, "results/captcha"), { recursive: true });
  fs.mkdirSync(path.join(work, ".captcha-runs/pending"), { recursive: true });
  fs.writeFileSync(path.join(work, `.captcha-runs/pending/${id}.exporting`), "");
  fs.writeFileSync(path.join(work, `results/captcha/${id}.json`),
    JSON.stringify({ id, complete, halted: false, interrupted: false }) + "\n");
}

test("an export left unstaged by an interrupted publisher is published, not skipped", t => {
  const { work, cliCalls, run, published } = setup(t);
  leaveExport(work, ID, true);
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(cliCalls().length, 0);
});

test("an incomplete export left by an interrupted publisher is held for review", t => {
  const { work, cliCalls, run, published } = setup(t);
  leaveExport(work, ID, false);
  const result = run();
  assert.equal(result.status, 1);
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.ok(!fs.existsSync(path.join(work, `results/captcha/${ID}.json`)));
  assert.match(fs.readFileSync(path.join(work, ".captcha-runs/needs-review"), "utf8"), /not a complete campaign/);
  assert.equal(cliCalls().length, 0);
});

test("an export the publisher did not make is left for PR review, never pushed", t => {
  const { work, cliCalls, run, published } = setup(t);
  const manual = "2026-11-04-west-v3-rerun";
  fs.mkdirSync(path.join(work, "results/captcha"), { recursive: true });
  fs.writeFileSync(path.join(work, `results/captcha/${manual}.json`),
    JSON.stringify({ id: manual, complete: true, halted: false, interrupted: false }) + "\n");
  const result = run([], {}, { reset: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /needs PR review/);
  assert.ok(!published().includes(`results/captcha/${manual}.json`));
  assert.ok(fs.existsSync(path.join(work, `results/captcha/${manual}.json`)));
  assert.ok(published().includes(`results/captcha/${ID}.json`));
  assert.equal(cliCalls().length, 1);
});

test("an export someone else left at the daily id is never claimed or pushed", t => {
  const { work, cliCalls, run, published } = setup(t);
  fs.mkdirSync(path.join(work, "results/captcha"), { recursive: true });
  fs.writeFileSync(path.join(work, `results/captcha/${ID}.json`),
    JSON.stringify({ id: ID, complete: true, halted: false, interrupted: false }) + "\n");
  for (const attempt of [run([], {}, { reset: true }), run([], {}, { reset: true })]) {
    assert.equal(attempt.status, 1, attempt.stdout + attempt.stderr);
    assert.match(attempt.stdout + attempt.stderr, /this publisher did not export it/);
  }
  assert.ok(!published().includes(`results/captcha/${ID}.json`));
  assert.ok(!fs.existsSync(path.join(work, `.captcha-runs/pending/${ID}.exporting`)));
  assert.equal(cliCalls().length, 0);
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

test("the default time limit covers a campaign where every attempt uses its full limits", t => {
  const { run } = setup(t);
  assert.match(fs.readFileSync(script, "utf8"), new RegExp(`^CAPTCHA_TYPES=${FIXTURES.length}$`, "m"),
    "CAPTCHA_TYPES must match the protocol's fixtures");
  for (const runs of [5, 20]) {
    const result = run([`--runs=${runs}`]);
    const timeout = Number((result.stdout + result.stderr).match(/ timeout=(\d+)s /)[1]);
    // 425 s per attempt (including a failed release's recovery), three sessions at a time.
    const worstCase = Math.ceil(runs * DAILY_PROVIDERS.length * FIXTURES.length * 425 / 3);
    assert.ok(timeout >= worstCase, `${timeout}s < worst case ${worstCase}s at --runs=${runs}`);
  }
  const explicit = run(["--timeout=60", "--date=2026-11-06"]);
  assert.match(explicit.stdout + explicit.stderr, / timeout=60s /);
});

test("daily CAPTCHA run rejects out-of-range options before doing any work", t => {
  const { cliCalls, run } = setup(t);
  for (const args of [["--runs=0"], ["--runs=21"], ["--runs=x"], ["--timeout=0"], ["--date=today"], ["--nope"]])
    assert.notEqual(run(args).status, 0, args.join(" "));
  assert.equal(cliCalls().length, 0);
});
