import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { ProviderClient } from "../types.js";
import { createSessionWithBackoff, RATE_LIMIT_BACKOFF_MS, type SessionCreationDiagnostics } from "../utils/create-session.js";
import { runSingleSession as runHello } from "../benchmarks/hello-browser/run.js";
import { runSingleSession as runThroughput } from "../benchmarks/browser-throughput/run.js";
import { runSingleSession as runV0 } from "../benchmarks/v0/run.js";

const diagnostics = (): SessionCreationDiagnostics => ({ attempts: 0, backoff_ms: 0, elapsed_ms: 0, errors: [] });
const session = { id: "session", cdpUrl: "ws://fixture.invalid" };
const creditMessage = "[Hyperbrowser]: You have reached your credit limit. Please upgrade your plan or purchase more credits.";

function fixture(create: ProviderClient["create"]): ProviderClient {
  return { name: "HYPERBROWSER", create, release: async () => {}, computeCost: () => 0 };
}

test("Hyperbrowser's recorded credit-limit rejection fails immediately, including HTTP 429", async () => {
  for (const statusCode of [undefined, 402, 429]) {
    let attempts = 0;
    const error = Object.assign(new Error(creditMessage), { statusCode, code: "CREDIT_LIMIT", requestId: "request-1" });
    const d = diagnostics();
    await assert.rejects(createSessionWithBackoff(fixture(async () => { attempts++; throw error; }), d), e => e === error);
    assert.equal(attempts, 1);
    assert.equal(d.backoff_ms, 0);
    assert.deepEqual(d.errors, [{ attempt: 1, status: statusCode ?? null, code: "CREDIT_LIMIT", request_id: "request-1", message: creditMessage }]);
    assert.ok(d.elapsed_ms >= 0);
  }
});

test("HTTP 429 gets at most three attempts and two backoffs", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  const error = Object.assign(new Error("Too many requests"), { statusCode: 429 });
  let attempts = 0;
  const d = diagnostics();
  const failed = assert.rejects(createSessionWithBackoff(fixture(async () => { attempts++; throw error; }), d), e => e === error);
  await setImmediate();
  assert.equal(attempts, 1);
  t.mock.timers.tick(RATE_LIMIT_BACKOFF_MS);
  await setImmediate();
  assert.equal(attempts, 2);
  t.mock.timers.tick(RATE_LIMIT_BACKOFF_MS);
  await failed;
  assert.equal(attempts, 3);
  assert.equal(d.attempts, 3);
  assert.equal(d.backoff_ms, 60_000);
  assert.equal(d.errors.length, 3);
});

test("a successful retry retains rejected attempts and backoff diagnostics", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  let attempts = 0;
  const d = diagnostics();
  const pending = createSessionWithBackoff(fixture(async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error("Too many requests"), { status: 429 });
    return session;
  }), d);
  await setImmediate();
  t.mock.timers.tick(RATE_LIMIT_BACKOFF_MS);
  const result = await pending;
  assert.deepEqual(result.session, session);
  assert.equal(typeof result.creationMs, "number");
  assert.equal(d.attempts, 2);
  assert.equal(d.backoff_ms, 30_000);
  assert.equal(d.errors[0].status, 429);
});

test("ambiguous create failures are not retried, even if their message contains rate or limit", async () => {
  const errors = [
    new Error("Unable to generate session"),
    new Error("Session limit reached"),
    new Error("Network timeout"),
    Object.assign(new Error("Rate limit service unavailable"), { status: 503 }),
    Object.assign(new Error("Too many requests"), { status: 403 }),
  ];
  for (const error of errors) {
    let attempts = 0;
    await assert.rejects(createSessionWithBackoff(fixture(async () => { attempts++; throw error; }), diagnostics()), e => e === error);
    assert.equal(attempts, 1, error.message);
  }
});

test("legacy explicit rate-limit messages retain bounded backoff and sanitize diagnostics", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const log = t.mock.method(console, "error", () => {});
  let attempts = 0;
  const d = diagnostics();
  const pending = createSessionWithBackoff(fixture(async () => {
    attempts++;
    if (attempts === 1) throw new Error("Rate limit: ?api_key=secret-value wss://private.invalid?token=secret 10.0.0.1");
    return session;
  }), d);
  await setImmediate();
  t.mock.timers.tick(RATE_LIMIT_BACKOFF_MS);
  await pending;
  assert.equal(d.attempts, 2);
  const recorded = JSON.stringify(d) + JSON.stringify(log.mock.calls.map(c => c.arguments));
  assert.doesNotMatch(recorded, /secret-value|wss:\/\/private|10\.0\.0\.1/);
  assert.match(recorded, /redacted/);
});

test("lifecycle, throughput, and v0 record quota rejections as failed sessions", async t => {
  t.mock.method(console, "error", () => {});
  const provider = fixture(async () => { throw Object.assign(new Error(creditMessage), { statusCode: 429, requestId: "request-quota" }); });
  const records = [
    await runHello(provider, "https://example.com/"),
    await runThroughput(provider, { concurrency: 1, loops: 1, urlForLoop: () => "https://example.com/" }),
    await runV0(provider, "https://example.com/"),
  ];
  for (const record of records) {
    assert.equal(record.success, false);
    assert.equal(record.error_stage, "session_create");
    assert.equal(record.session_creation_ms, null);
    assert.equal(record.session_creation_diagnostics?.attempts, 1);
    assert.equal(record.session_creation_diagnostics?.backoff_ms, 0);
    assert.equal(record.session_creation_diagnostics?.errors[0].request_id, "request-quota");
    assert.match(record.error_message!, /credit limit/);
  }
});
