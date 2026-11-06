import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { acceptedGeetest, acceptedOfficial, acceptedRecaptchaV3, captchaTypes, configuration, FIXTURES, passedText,
  preflight, reachedPerimeterX, schedule, summarize, V3_FIXTURES } from "./protocol.mjs";
import { attempt, submit } from "./run.mjs";

const config = configuration();
const by = type => FIXTURES.find(f => f.type === type);
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

// A fake of every public fixture, with one switch per contract the preflight checks.
function fixtureServer(change = {}) {
  const calls = [];
  const html = { turnstile: by("turnstile").sitekey, recaptcha: by("recaptcha").sitekey, hcaptcha: by("hcaptcha").sitekey,
    "recaptcha-v3": '<button data-action="demo_action">', geetest: '<form id="geetest-demo-form">', text: '<input id="simple-captcha-field">' };
  const request = async (url, options = {}) => {
    const target = String(url); calls.push({ url: target, options });
    if (change.status?.[target]) return new Response("blocked", { status: change.status[target] });
    if (target === by("perimeterx").url) return change.walmart ?? new Response(null, { status: 307, headers: { location: "/blocked?url=x" } });
    if (target.startsWith(new URL(by("geetest").init, by("geetest").url).href))
      return response(change.geetestInit ?? { success: 1, gt: by("geetest").gt, challenge: "c".repeat(32) });
    if (options.method === "POST") {
      if (target === new URL(by("turnstile").verifier, by("turnstile").url).href)
        return response(change.turnstile ?? { success: false, testSecret: false, widget: "managed" });
      if (target === by("hcaptcha").url) {
        const verdict = change.hcaptcha ?? { success: false, "error-codes": ["not-using-dummy-secret"] };
        return new Response(`<pre class="hcaptcha-success">${JSON.stringify(verdict, null, 4).replaceAll('"', "&#34;")}</pre>`);
      }
      if (target === new URL(by("recaptcha-v3").verifier, by("recaptcha-v3").url).href) return response(change.v3 ?? { success: false });
      if (target === new URL(by("geetest").verifier, by("geetest").url).href) return response(change.geetest ?? { success: false });
      throw new Error(`Unexpected POST ${target}`);
    }
    const fixture = FIXTURES.find(f => f.url === target);
    if (!fixture) throw new Error(`Unexpected GET ${target}`);
    return new Response(change.markup?.[fixture.type] ?? html[fixture.type]);
  };
  return { request, calls };
}

test("preflight checks every v4 contract and real-secret rejection without opening sessions", async () => {
  const server = fixtureServer();
  const result = await preflight(server.request);
  assert.deepEqual(result.observations.map(o => o.type), FIXTURES.map(f => f.type));
  assert.equal(result.observations.at(-1).blocked, true);
  assert.ok(server.calls.every(call => !/nopecha/.test(call.url)), "NopeCHA blocks every visitor; v4 never calls it");
  assert.deepEqual(result.hcaptcha_test_token, { success: false, errorCodes: ["not-using-dummy-secret"] });
  const walmartPage = new Response(`<script>window._pxAppId = '${by("perimeterx").appId}';</script>`);
  assert.equal((await preflight(fixtureServer({ walmart: walmartPage }).request)).observations.at(-1).httpStatus, 200);
  for (const [change, error] of [
    [{ markup: { hcaptcha: "other sitekey" } }, /hcaptcha fixture sitekey or markup changed/],
    [{ markup: { text: "<p>redesigned</p>" } }, /text fixture/],
    [{ status: { [by("recaptcha-v3").url]: 403 } }, /recaptcha-v3 fixture HTTP 403/],
    [{ turnstile: { success: true, testSecret: true, widget: "managed" } }, /Turnstile verifier/],
    [{ hcaptcha: { success: true, hostname: "dummy-key-pass" } }, /hCaptcha demo did not reject the test token/],
    [{ hcaptcha: { success: false, "error-codes": ["invalid-input-response"] } }, /real secret/],
    [{ v3: { success: true, score: 0.9 } }, /reCAPTCHA v3 verifier/],
    [{ geetestInit: { success: 0, gt: by("geetest").gt } }, /GeeTest demo is offline/],
    [{ geetestInit: { success: 1, gt: "other" } }, /gt changed/],
    [{ geetest: { success: true } }, /GeeTest verifier/],
    [{ walmart: new Response("<p>no PerimeterX</p>") }, /PerimeterX app/],
    [{ walmart: new Response(null, { status: 307, headers: { location: "https://example.com/" } }) }, /perimeterx fixture HTTP 307/],
  ]) await assert.rejects(() => preflight(fixtureServer(change).request), error);
});

test("protocol v3 keeps its three fixtures and labels; v4 declares seven typed columns", () => {
  const v3 = configuration({ version: 3 });
  assert.deepEqual(v3.fixtures, V3_FIXTURES);
  assert.equal(v3.fixtures[2].url, "https://nopecha.com/captcha/hcaptcha#enterprise");
  assert.equal(schedule(v3).flat().length, v3.providers.length * 3 * 5);
  assert.deepEqual(captchaTypes(3).map(t => t.signal_label), ["Server acceptance", "Server acceptance", "Token delivery only"]);
  assert.deepEqual(captchaTypes(4).map(t => [t.id, t.label, t.signal_label]), [
    ["turnstile", "Cloudflare Turnstile", "Server acceptance"], ["recaptcha", "reCAPTCHA v2", "Server acceptance"],
    ["hcaptcha", "hCaptcha", "Server acceptance"], ["recaptcha-v3", "reCAPTCHA v3", "Server acceptance"],
    ["geetest", "GeeTest v3", "Server acceptance"], ["text", "Text CAPTCHA", "Page check"], ["perimeterx", "PerimeterX", "Page reached"]]);
  // Turnstile and reCAPTCHA v2 are unchanged apart from naming their signal.
  assert.deepEqual(FIXTURES.slice(0, 2).map(({ signal, ...fixture }) => fixture), V3_FIXTURES.slice(0, 2));
});

test("verdict rules reject dummy secrets, low scores, offline GeeTest and pages that never cleared", () => {
  const hcaptcha = by("hcaptcha"), receipt = { method: "POST", url: hcaptcha.url, httpStatus: 200 };
  const state = { siteverify: { success: true, hostname: "hcaptcha.com" } };
  assert.equal(acceptedOfficial(state, receipt, hcaptcha), true);
  assert.equal(acceptedOfficial({ siteverify: { success: true, hostname: "dummy-key-pass" } }, receipt, hcaptcha), false);
  assert.equal(acceptedOfficial(state, { ...receipt, url: `${hcaptcha.url}?secret=0x0` }, hcaptcha), false);
  assert.equal(acceptedOfficial(state, null, hcaptcha), false);
  assert.equal(acceptedOfficial({ siteverify: { success: "true", hostname: "hcaptcha.com" } }, receipt, hcaptcha), false);

  const v3 = by("recaptcha-v3"), verdict = { httpStatus: 200, success: true, hostname: "2captcha.com", action: "demo_action", score: 0.5 };
  assert.equal(acceptedRecaptchaV3(verdict, v3), true);
  for (const change of [{ score: 0.3 }, { score: "0.9" }, { score: undefined }, { action: "other" }, { hostname: "evil.example" }, { success: "true" }, { httpStatus: 500 }])
    assert.equal(acceptedRecaptchaV3({ ...verdict, ...change }, v3), false);

  const geetest = by("geetest"), online = { online: true, gt: geetest.gt };
  assert.equal(acceptedGeetest({ httpStatus: 200, success: true }, online, geetest), true);
  assert.equal(acceptedGeetest({ httpStatus: 200, success: true }, { online: false, gt: geetest.gt }, geetest), false);
  assert.equal(acceptedGeetest({ httpStatus: 200, success: true }, { online: true, gt: "other" }, geetest), false);
  assert.equal(acceptedGeetest({ httpStatus: 200, success: 1 }, online, geetest), false);
  assert.equal(acceptedGeetest({ httpStatus: 200, success: true }, null, geetest), false);

  assert.equal(passedText({ passed: true, failed: false }), true);
  assert.equal(passedText({ passed: true, failed: true }), false);

  const px = by("perimeterx"), page = { url: px.url, challenge: false, searchReady: true, appId: px.appId };
  assert.equal(reachedPerimeterX(page, px), true);
  for (const change of [{ challenge: true }, { searchReady: false }, { appId: null }, { url: "https://www.walmart.com/search?q=other" },
    { url: "https://www.walmart.com/blocked?url=x" }, { url: "https://evil.example/search?q=desk+lamp" }])
    assert.equal(reachedPerimeterX({ ...page, ...change }, px), false);
});

// A provider session whose page reports the given states in order (the last repeats).
function harness(fixture, states, { verify = async () => null, navigation = 200, responses = [] } = {}) {
  let clock = 0, releases = 0, probes = 0, submissions = 0;
  const page = new EventEmitter();
  page.setDefaultTimeout = () => {};
  page.setViewportSize = async () => {};
  page.goto = async () => {
    clock += 100;
    for (const item of responses) page.emit("response", item);
    return { status: () => navigation };
  };
  const task = { id: `r01-kernel-${fixture.type}`, provider: "kernel", round: 1, fixture };
  const deps = { clean: String, now: () => clock, sleep: async ms => { clock += ms; },
    create: async () => ({ id: "owned-id", cdpUrl: "wss://private.example", release: async () => { releases++; } }),
    chromium: { connectOverCDP: async () => ({ contexts: () => [{ pages: () => [page] }], close: async () => {} }) },
    probe: async () => ({ formPresent: true, rejected: false, ...states[Math.min(probes++, states.length - 1)] }),
    verify: async (...args) => { submissions++; clock += 200; return verify(page, ...args); },
  };
  return { task, deps, page, counts: () => ({ releases, submissions, probes }), at: () => clock };
}
const jsonResponse = (url, body) => ({ url: () => url, status: () => 200,
  request: () => ({ method: () => "GET" }), json: async () => body });

test("hCaptcha v4 counts only the demo's own siteverify success after an observed POST", async () => {
  const fixture = by("hcaptcha"), accepted = { siteverify: { success: true, hostname: fixture.hostname } };
  const h = harness(fixture, [{ tokenPresent: false }, { tokenPresent: true }, accepted], {
    verify: async page => { page.emit("response", { url: () => fixture.url, status: () => 200, request: () => ({ method: () => "POST" }) }); return null; } });
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "verified"); assert.ok(row.accepted_ms > row.token_ms);
  assert.equal(h.counts().submissions, 1); assert.equal(h.counts().releases, 1);
  const rejected = harness(fixture, [{ tokenPresent: false }, { tokenPresent: true }, { siteverify: { success: false }, rejected: true }]);
  assert.equal((await attempt(rejected.task, config, rejected.deps)).status, "rejected");
  const drift = harness(fixture, [{ drift: "hCaptcha sitekey changed" }]);
  const driftRow = await attempt(drift.task, config, drift.deps);
  assert.equal(driftRow.status, "error"); assert.match(driftRow.error, /Fixture drift/);
  // Drift stops the campaign, so an incomplete run is never published; cleanup still ran.
  assert.equal(driftRow.fixture_drift, true); assert.equal(driftRow.halt_campaign, true);
  assert.equal(drift.counts().releases, 1);
});

test("reCAPTCHA v3 submits once the page's own script is ready and needs the score threshold", async () => {
  const fixture = by("recaptcha-v3");
  for (const [score, status] of [[0.9, "verified"], [0.3, "rejected"]]) {
    const h = harness(fixture, [{ ready: false }, { ready: true }], {
      verify: async () => ({ httpStatus: 200, success: true, hostname: "2captcha.com", action: "demo_action", score }) });
    const row = await attempt(h.task, config, h.deps);
    assert.equal(row.status, status); assert.equal(row.verification.score, score);
    assert.equal(row.token_ms, undefined, "v3 has no widget token before submission");
    assert.equal(h.counts().submissions, 1);
  }
  const never = harness(fixture, [{ ready: false }]);
  assert.equal((await attempt(never.task, config, never.deps)).status, "timeout");
});

test("reCAPTCHA v3 submission waits for the page's verifier response and reports its fields", async () => {
  const fixture = by("recaptcha-v3"), verifier = new URL(fixture.verifier, fixture.url).href;
  let submitted = false;
  const page = {
    waitForResponse: async predicate => {
      const candidate = { url: () => verifier, status: () => 200, request: () => ({ method: () => "POST" }),
        json: async () => ({ success: true, hostname: "2captcha.com", action: "demo_action", score: 0.7, extra: "ignored" }) };
      assert.equal(predicate(candidate), true);
      assert.equal(predicate({ ...candidate, url: () => `${verifier}?x` }), false);
      return candidate;
    },
    locator: selector => { assert.equal(selector, fixture.form); return { evaluate: async () => { submitted = true; } }; },
  };
  assert.deepEqual(await submit(page, fixture), { httpStatus: 200, success: true, hostname: "2captcha.com",
    action: "demo_action", score: 0.7, errorCodes: undefined });
  assert.equal(submitted, true);
  await assert.rejects(() => submit({}, by("perimeterx")), /no submission/);
});

test("GeeTest is accepted only by the verifier in online mode with the pinned gt", async () => {
  const fixture = by("geetest"), init = new URL(fixture.init, fixture.url).href;
  const cases = [
    [[jsonResponse(`${init}?t=1`, { success: 1, gt: fixture.gt })], "verified"],
    [[jsonResponse(`${init}?t=1`, { success: 0, gt: fixture.gt })], "rejected"],
    [[], "error"],
    [[jsonResponse(`${init}?t=1`, { success: 1, gt: "other" })], "drift"],
  ];
  for (const [responses, status] of cases) {
    const h = harness(fixture, [{ tokenPresent: false }, { tokenPresent: true }], { responses,
      verify: async () => ({ httpStatus: 200, success: true }) });
    const row = await attempt(h.task, config, h.deps);
    if (status === "drift") { assert.equal(row.status, "error"); assert.equal(row.halt_campaign, true); continue; }
    assert.equal(row.status, status, JSON.stringify(responses.length));
    assert.equal(row.halt_campaign, false);
    if (status === "error") assert.match(row.error, /init parameters were not observed/);
    else assert.equal(row.geetest_init.online, status === "verified");
  }
});

test("text CAPTCHA submits a stable solver answer and reports a page check, never acceptance", async () => {
  const fixture = by("text");
  const filling = [{ tokenPresent: false, imageReady: true, answer: "" },
    { tokenPresent: true, imageReady: true, answer: "w9" }, { tokenPresent: true, imageReady: true, answer: "w9h5k" },
    { tokenPresent: true, imageReady: true, answer: "w9h5k" }, { passed: true, failed: false }];
  const h = harness(fixture, filling);
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "page_passed"); assert.equal(row.accepted_ms, null);
  assert.ok(row.passed_ms > row.token_ms); assert.equal(h.counts().submissions, 1);
  assert.equal(row.submitted_answer, "w9h5k");
  // Initial probe, then "w9", "w9h5k", "w9h5k" (stable, submitted) and the verdict.
  assert.equal(h.counts().probes, 5, "submits only after the answer stopped changing");
  const cell = summarize(configuration({ providers: ["kernel"], rounds: 1 }), [row]).find(c => c.type === "text");
  assert.equal(cell.succeeded, 1); assert.equal(cell.verified, 0); assert.equal(cell.page_passed, 1);
  assert.equal(cell.success_median_ms, row.passed_ms); assert.equal(cell.signal, "page_check");
  const wrong = harness(fixture, [...filling.slice(0, 4), { passed: false, failed: true, rejected: true }]);
  assert.equal((await attempt(wrong.task, config, wrong.deps)).status, "rejected");
  // A solver that typed during navigation still goes through the stability check.
  const early = harness(fixture, [{ tokenPresent: true, imageReady: true, answer: "w9h5k" },
    { tokenPresent: true, imageReady: true, answer: "w9h5k" }, { tokenPresent: true, imageReady: true, answer: "w9h5k" },
    { passed: true, failed: false }]);
  const earlyRow = await attempt(early.task, config, early.deps);
  assert.equal(earlyRow.status, "page_passed"); assert.equal(early.counts().submissions, 1);
  const stale = harness(fixture, [{ passed: true, failed: false }]);
  const staleRow = await attempt(stale.task, config, stale.deps);
  assert.equal(staleRow.status, "error"); assert.match(staleRow.error, /not a fresh challenge/);
  assert.equal(staleRow.halt_campaign, false);
});

test("PerimeterX passes when Walmart results stay usable for five seconds, from the moment they cleared", async () => {
  const fixture = by("perimeterx"), usable = { url: fixture.url, challenge: false, searchReady: true, appId: fixture.appId };
  const blocked = { url: "https://www.walmart.com/blocked?url=x", challenge: true, searchReady: false, appId: fixture.appId };
  const h = harness(fixture, [blocked, blocked, usable, { ...usable, challenge: true }, usable], { navigation: 403 });
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "page_passed"); assert.equal(row.challenge_seen, true);
  assert.equal(row.navigation_http_status, 403);
  // Probes run each second from 100ms; the challenge flash at 2.1s restarts the window at 3.1s.
  assert.equal(row.passed_ms, 3_100); assert.equal(h.counts().submissions, 0);
  const unchallenged = harness(fixture, [usable]);
  const clean = await attempt(unchallenged.task, config, unchallenged.deps);
  assert.equal(clean.status, "page_passed"); assert.equal(clean.challenge_seen, undefined);
  const stuck = harness(fixture, [blocked]);
  assert.equal((await attempt(stuck.task, config, stuck.deps)).status, "timeout");
  const unprotected = harness(fixture, [{ ...usable, appId: null }]);
  assert.equal((await attempt(unprotected.task, config, unprotected.deps)).status, "timeout");
});
