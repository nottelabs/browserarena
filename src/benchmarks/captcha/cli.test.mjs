import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptchaArgs, runCaptchaCli } from "./cli.mjs";

test("CAPTCHA CLI declares its own defaults and rejects ignored lifecycle flags", () => {
  const defaults = parseCaptchaArgs(["--benchmark=captcha"], {});
  assert.equal(defaults.config.rounds, 5);
  assert.equal(defaults.config.providers.length, 5);
  assert.equal(defaults.config.concurrency, 3);
  for (const args of [["--record"], ["--url=https://example.com"], ["--runs"], ["--runs=0"],
    ["--concurrency=1,3"], ["--runs=1", "--runs=2"], ["--preflight=false"], ["--provider=notte,notte"]])
    assert.throws(() => parseCaptchaArgs(args, {}));
});

test("CAPTCHA CLI honors explicit options and routes preflight without opening sessions", async () => {
  let called = false;
  await runCaptchaCli(["--benchmark=captcha", "--provider", "kernel,notte", "--runs=1", "--concurrency=2", "--out=/tmp/captcha-evidence", "--preflight"],
    "/repository", async (config, output, repository, options) => {
      called = true;
      assert.deepEqual(config.providers, ["kernel", "notte"]);
      assert.equal(config.rounds, 1);
      assert.equal(config.concurrency, 2);
      assert.equal(output, "/tmp/captcha-evidence");
      assert.equal(repository, "/repository");
      assert.equal(options.preflightOnly, true);
    }, { RUNS: "20", PROVIDER: "steel" });
  assert.equal(called, true);
});
