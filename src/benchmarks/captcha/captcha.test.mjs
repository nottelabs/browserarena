import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { acceptedOfficial, acceptedTurnstile, configuration, FIXTURES, interval, schedule, summarize } from "./protocol.mjs";
import { attempt, installCancellation, refusedCreate, runSuite, submit } from "./run.mjs";
import { createProviders, REQUIRED_ENV } from "./providers.mjs";
import { report, sanitizer } from "./main.mjs";

const config = configuration();
const clean = sanitizer(value => value.replace(/wss?:\/\/[^\s]+/g, "[websocket omitted]"), { TEST_API_KEY: "private-test-value" });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("protocol fixes the declared workload and rejects ignored settings", () => {
  assert.equal(config.rounds, 5);
  assert.equal(config.version, 4);
  assert.equal(config.solveTimeoutMs, 180_000);
  assert.deepEqual(config.viewport, { width: 1920, height: 1080 });
  for (const input of [{ rounds: 0 }, { rounds: 1.5 }, { concurrency: 4 }, { providers: ["kernel", "kernel"] },
    { providers: ["unknown"] }, { solveTimeoutMs: 999 }, { cooldownMs: 0 }, { retries: 1 }, { fixtures: [] }, { version: 5 }])
    assert.throws(() => configuration(input));
});

test("unique attempts rotate provider and fixture order with five attempts per cell", () => {
  const rounds = schedule(config), tasks = rounds.flat(), total = config.providers.length * FIXTURES.length * 5;
  assert.equal(config.providers.length, 9);
  assert.equal(tasks.length, total);
  assert.equal(new Set(tasks.map(task => task.id)).size, total);
  assert.deepEqual(rounds.map(round => round[0].provider), config.providers.slice(0, config.rounds));
  assert.deepEqual(rounds.map(round => round[0].fixture.type), ["turnstile", "recaptcha", "hcaptcha", "recaptcha-v3", "geetest"]);
  for (const provider of config.providers) for (const fixture of FIXTURES)
    assert.equal(tasks.filter(task => task.provider === provider && task.fixture.type === fixture.type).length, 5);
});

test("external acceptance rejects test secrets, false-like strings, wrong origins and client-only success", () => {
  const valid = { httpStatus: 200, success: true, testSecret: false, hostname: "zerocaptcha.io", widget: "managed" };
  assert.equal(acceptedTurnstile(valid), true);
  for (const change of [{ testSecret: true }, { testSecret: "false" }, { success: "true" }, { hostname: "other.example" }, { httpStatus: 500 }, { widget: "invisible" }])
    assert.equal(acceptedTurnstile({ ...valid, ...change }), false);
  const fixture = FIXTURES[1], state = { accepted: true, formPresent: false };
  const receipt = { method: "POST", url: fixture.url, httpStatus: 200 };
  assert.equal(acceptedOfficial(state, receipt, fixture), true);
  assert.equal(acceptedOfficial(state, null, fixture), false);
  assert.equal(acceptedOfficial({ ...state, formPresent: true }, receipt, fixture), false);
  assert.equal(acceptedOfficial(state, { ...receipt, method: "GET" }, fixture), false);
  assert.equal(acceptedOfficial(state, { ...receipt, url: "https://other.example" }, fixture), false);
});

test("counts retain every failed attempt and show wide intervals for five samples", () => {
  const tasks = schedule(configuration({ providers: ["kernel"] })).flat();
  const rows = tasks.map((task, index) => ({ ...task, type: task.fixture.type,
    status: index % 3 === 0 ? "verified" : index % 3 === 1 ? "timeout" : "error", accepted_ms: 100 + index }));
  const cells = summarize(configuration({ providers: ["kernel"] }), rows);
  assert.equal(cells.reduce((sum, cell) => sum + cell.attempted, 0), 35);
  assert.equal(cells.reduce((sum, cell) => sum + cell.verified + cell.timeout + cell.error, 0), 35);
  assert.ok(interval(5, 5)[0] > 0.56 && interval(5, 5)[0] < 0.57);
  assert.ok(interval(0, 5)[1] > 0.43 && interval(0, 5)[1] < 0.44);
  assert.equal(interval(0, 0), null);
  assert.throws(() => summarize(config, [rows[0], rows[0]]), /Duplicate/);
});

test("scheduler completes fixed failure counts, caps global concurrency and never overlaps a provider", async () => {
  const active = new Set(), saved = []; let maximum = 0;
  const result = await runSuite(config, {
    runAttempt: async task => {
      assert.equal(active.has(task.provider), false);
      active.add(task.provider); maximum = Math.max(maximum, active.size);
      await new Promise(resolve => setImmediate(resolve));
      active.delete(task.provider);
      return { id: task.id, provider: task.provider, type: task.fixture.type, status: "timeout" };
    },
    save: async row => { saved.push(row); },
    sleep: async ms => { assert.equal(ms, 5_000); await new Promise(resolve => setImmediate(resolve)); },
  });
  assert.equal(result.rows.length, config.providers.length * FIXTURES.length * 5);
  assert.equal(saved.length, config.providers.length * FIXTURES.length * 5);
  assert.equal(result.not_run.length, 0);
  assert.ok(maximum <= 3);
});

test("a provider cannot start its next attempt until the post-cleanup cooldown ends", async () => {
  const gates = [], started = [];
  const running = runSuite(configuration({ providers: ["kernel"], rounds: 1 }), {
    runAttempt: async task => { started.push(task.id); return { id: task.id }; }, save: async () => {},
    sleep: () => new Promise(resolve => gates.push(resolve)),
  });
  for (let count = 1; count <= FIXTURES.length; count++) {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, count);
    gates.shift()();
  }
  assert.equal((await running).rows.length, FIXTURES.length);
});

test("a critical ownership failure stops starts immediately, before its journal save finishes", async () => {
  const started = [];
  const result = await runSuite(config, {
    runAttempt: async task => { started.push(task.id); return { id: task.id, halt_campaign: true }; },
    save: async () => new Promise(resolve => setImmediate(resolve)), sleep: async () => assert.fail("No cooldown after critical failure"),
  });
  assert.equal(started.length, 3);
  assert.equal(result.halted, true);
  assert.equal(result.not_run.length, config.providers.length * FIXTURES.length * 5 - 3);
});

function harness({ failNavigation = false, failRelease = false, missingCdp = false, token = true, noReceipt = false } = {}) {
  let clock = 0, verified = false, releases = 0, closed = 0;
  const page = new EventEmitter();
  page.setDefaultTimeout = () => {};
  page.setViewportSize = async viewport => assert.deepEqual(viewport, config.viewport);
  page.goto = async () => { clock += 100; if (failNavigation) throw new Error("private-test-value wss://private.example"); return { status: () => 200 }; };
  const events = [];
  const task = { id: "r01-kernel-recaptcha", provider: "kernel", round: 1, fixture: FIXTURES[1] };
  const deps = { clean, now: () => clock, sleep: async ms => { clock += ms; },
    journal: async event => events.push(event),
    create: async () => ({ id: "owned-id", cdpUrl: missingCdp ? undefined : "wss://private.example",
      release: async () => { releases++; if (failRelease) throw new Error("private-test-value"); } }),
    chromium: { connectOverCDP: async () => ({ contexts: () => [{ pages: () => [page] }], close: async () => { closed++; } }) },
    probe: async () => ({ formPresent: !verified, tokenPresent: token && !verified, accepted: verified }),
    verify: async () => { clock += 200; verified = true; if (!noReceipt)
      page.emit("response", { url: () => task.fixture.url, status: () => 200, request: () => ({ method: () => "POST" }) }); return null; },
  };
  return { deps, task, events, counts: () => ({ releases, closed }) };
}

test("server-accepted POST is required and known sessions release after every outcome", async () => {
  const h = harness();
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "verified");
  assert.equal(row.accepted_ms, 300);
  assert.deepEqual(h.counts(), { releases: 1, closed: 1 });
  assert.equal(h.events[1].session_id, "owned-id");
  const noReceipt = harness({ noReceipt: true });
  const failed = await attempt(noReceipt.task, config, noReceipt.deps);
  assert.equal(failed.status, "error");
  assert.match(failed.error, /independent verification verdict/);
});

test("official submission waits for the new document before another page probe", async () => {
  const page = new EventEmitter(); let navigating = false;
  page.waitForEvent = name => new Promise(resolve => page.once(name, resolve));
  page.locator = () => ({ evaluate: async () => {
    navigating = true;
    setImmediate(() => { navigating = false; page.emit("domcontentloaded"); });
  } });
  await submit(page, FIXTURES[1]);
  assert.equal(navigating, false, "A probe during navigation would destroy its execution context");
});

test("acceptance observed after the fixed solve deadline is not counted", async () => {
  const h = harness(), probe = h.deps.probe;
  h.deps.probe = async (...args) => {
    const state = await probe(...args);
    if (state.accepted) await h.deps.sleep(180_001);
    return state;
  };
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "timeout"); assert.equal(row.accepted_ms, null);
});

test("verification time includes submission and late accepted pages remain verification errors", async () => {
  const h = harness(), verify = h.deps.verify;
  h.deps.verify = async (...args) => { await h.deps.sleep(15_001); return verify(...args); };
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "error"); assert.equal(row.accepted_ms, null);
  assert.match(row.error, /15s of submission/);
});

test("a probe cut off by the end of the solve window is a timeout, not an error", async () => {
  const h = harness({ token: false }), sleep = h.deps.sleep;
  let probes = 0;
  h.deps.sleep = async ms => { if (ms >= 1) await sleep(ms); };
  h.deps.probe = async () => {
    probes++;
    if (probes === 2) await sleep(179_999.5);
    if (probes === 3) return new Promise(() => {});
    return { formPresent: true, tokenPresent: false, accepted: false };
  };
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "timeout"); assert.equal(row.error, undefined);
  assert.equal(row.final.formPresent, true); assert.ok(row.elapsed_ms >= 179_999);
  assert.equal(h.counts().releases, 1);
});

test("a probe cut off by the end of the verification window reports the missing verdict", async () => {
  const h = harness(), probe = h.deps.probe, sleep = h.deps.sleep;
  let submitted = false;
  h.deps.verify = async () => { await sleep(14_999.5); submitted = true; return null; };
  h.deps.probe = async (...args) => submitted ? new Promise(() => {}) : probe(...args);
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "error"); assert.match(row.error, /15s of submission/);
});

test("a probe hanging with time left in the window stays a page error", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({ token: false });
  let probes = 0;
  h.deps.probe = async () => {
    probes++;
    if (probes === 2) return new Promise(() => {});
    return { formPresent: true, tokenPresent: false, accepted: false };
  };
  const running = attempt(h.task, config, h.deps);
  while (probes < 2) await new Promise(setImmediate);
  await new Promise(setImmediate);
  t.mock.timers.tick(10_000);
  const row = await running;
  assert.equal(row.status, "error"); assert.match(row.error, /exceeded 10000ms/);
});

test("a broken ownership journal halts further work but still releases the recovered ID", async () => {
  const h = harness();
  h.deps.journal = async event => { if (event.event === "session_created") throw new Error("Disk write failed"); };
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.journal_error, "Disk write failed"); assert.equal(row.halt_campaign, true);
  assert.equal(row.cleanup.released, true);
});

test("provider diagnostics cannot persist newly introduced solution or token payloads", async () => {
  const h = harness({ token: false }), create = h.deps.create;
  h.deps.create = async (...args) => ({ ...await create(...args), diagnostics: async () => [{
    isSolvingCaptcha: true, solution: "unlogged-captcha-response", tasks: [{
      type: "hcaptcha", status: "solving", solution: "unlogged-captcha-response", nested: { response: "unlogged-captcha-response" },
    }],
  }] });
  const row = await attempt(h.task, config, h.deps);
  assert.doesNotMatch(JSON.stringify(row), /unlogged-captcha-response/);
  assert.deepEqual(row.provider_diagnostics, [{ isSolvingCaptcha: true, tasks: [{ type: "hcaptcha", status: "solving" }] }]);
});

test("navigation errors redact secrets and release IDs; missing CDP retains ownership for cleanup", async () => {
  const h = harness({ failNavigation: true });
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "error"); assert.equal(row.stage, "navigate");
  assert.doesNotMatch(JSON.stringify(row), /private-test-value|wss:\/\//);
  assert.deepEqual(h.counts(), { releases: 1, closed: 1 });
  const bad = harness({ missingCdp: true });
  const invalid = await attempt(bad.task, config, bad.deps);
  assert.equal(invalid.session_id, "owned-id");
  assert.deepEqual(bad.counts(), { releases: 1, closed: 0 });
  const unknown = harness(); unknown.deps.create = async () => { throw new Error("Creation response lost"); };
  const uncertain = await attempt(unknown.task, config, unknown.deps);
  assert.equal(uncertain.ownership_unknown, true); assert.equal(uncertain.halt_campaign, true);
});

test("a session create the provider refuses with a 4xx is an error for that attempt, not a halt", async () => {
  const refuse = async (fields) => {
    const h = harness();
    h.deps.create = async () => { throw Object.assign(new Error("org limit exceeded"), fields); };
    return { row: await attempt(h.task, config, h.deps), counts: h.counts() };
  };
  // Kernel/Browserbase/Steel SDKs use `status`, Hyperbrowser's uses `statusCode`.
  for (const fields of [{ status: 429 }, { status: 401 }, { statusCode: 402 }]) {
    const { row, counts } = await refuse(fields);
    assert.equal(row.status, "error"); assert.equal(row.stage, "create");
    assert.equal(row.create_refused, true); assert.equal(row.ownership_unknown, undefined);
    assert.equal(row.halt_campaign, false, JSON.stringify(fields));
    assert.deepEqual(counts, { releases: 0, closed: 0 });
  }
  // Timeouts, server errors and errors without a status may have created a session.
  for (const fields of [{ status: 408 }, { status: 500 }, { status: "429" }, {}]) {
    const { row } = await refuse(fields);
    assert.equal(row.ownership_unknown, true, JSON.stringify(fields)); assert.equal(row.halt_campaign, true);
  }
  assert.equal(refusedCreate({ status: 499 }), true); assert.equal(refusedCreate(undefined), false);
});

test("provider API errors carry their HTTP status", async () => {
  const create = createProviders(() => ({}), { ANCHORBROWSER_API_KEY: "key" }, async () => new Response("{}", { status: 429 }));
  await assert.rejects(create("anchorbrowser"), error => error.status === 429 && /HTTP 429/.test(error.message));
});

test("cleanup failure remains visible after token acceptance and stops the campaign", async () => {
  const h = harness({ failRelease: true });
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "verified"); assert.equal(row.cleanup.released, false);
  assert.equal(row.cleanup.error, "[redacted]"); assert.equal(row.halt_campaign, true);
  assert.equal(summarize(config, [row]).find(cell => cell.provider === "kernel" && cell.type === "recaptcha").cleanup_errors, 1);
});

test("timeouts consume an attempt and cooperative cancellation still recovers and releases a create ID", async () => {
  const h = harness({ token: false });
  const row = await attempt(h.task, config, h.deps);
  assert.equal(row.status, "timeout"); assert.ok(row.elapsed_ms >= 180_000);
  const interrupted = harness(); const controller = new AbortController(); interrupted.deps.signal = controller.signal;
  interrupted.deps.create = async () => { controller.abort(); return { id: "owned-id", cdpUrl: "wss://private.example", release: async () => {} }; };
  const aborted = await attempt(interrupted.task, config, interrupted.deps);
  assert.equal(aborted.status, "interrupted"); assert.equal(aborted.cleanup.released, true);
  assert.equal(aborted.halt_campaign, false);
  const source = new EventEmitter(), stop = new AbortController();
  const remove = installCancellation(stop, source); source.emit("SIGHUP"); assert.equal(stop.signal.aborted, true); remove();
  assert.equal(source.listenerCount("SIGHUP"), 0);
  const beforeStart = harness(); beforeStart.deps.signal = controller.signal;
  beforeStart.deps.create = async () => assert.fail("Must not create after cancellation");
  assert.equal((await attempt(beforeStart.task, config, beforeStart.deps)).ownership_unknown, undefined);
});

test("five provider presets explicitly enable native solving and disable SDK request retries", async () => {
  const requests = [], creations = [];
  class SDK {
    constructor(options) {
      assert.equal(options.maxRetries, 0);
      this.sessions = { create: async body => { creations.push(body); return { id: "owned-id", connectUrl: "wss://browser.example", websocketUrl: "wss://steel.example?session=1" }; },
        update: async () => {}, release: async (_id, body, options) => {
          assert.deepEqual(body, {}); assert.deepEqual(options, { maxRetries: 0, timeout: 30_000 });
        }, captchas: { status: async () => [] } };
      this.browsers = { create: async body => { creations.push(body); return { session_id: "owned-id", cdp_ws_url: "wss://kernel.example" }; }, deleteByID: async () => {} };
    }
  }
  const create = createProviders(() => ({ Browserbase: SDK, default: SDK }), {}, async (url, options) => {
    requests.push({ url, options });
    return options.method === "DELETE" || options.method === "PATCH" ? new Response(null, { status: 204 })
      : response(url.includes("browser-use") ? { id: "owned-id", cdpUrl: "https://browser.example" }
        : { session_id: "owned-id", cdp_url: "wss://notte.example" });
  });
  for (const name of ["kernel", "browserbase", "browser-use", "steel", "notte"]) {
    const session = await create(name); assert.equal(session.id, "owned-id"); assert.equal(session.solve, undefined); await session.release();
  }
  assert.ok(!requests.some(r => r.url.includes("/page/execute")), "Notte relies on its automatic solver only");
  assert.equal(creations.find(c => c.stealth).headless, true);
  assert.equal(creations.find(c => c.browserSettings).browserSettings.solveCaptchas, true);
  assert.equal(creations.find(c => c.solveCaptcha).useProxy, true);
  assert.equal(JSON.parse(requests.find(r => r.url.includes("notte.cc/sessions/start")).options.body).solve_captchas, true);
  assert.equal(JSON.parse(requests.find(r => r.url.endsWith("/browsers")).options.body).proxyCountryCode, "us");
});

test("Hyperbrowser, Anchor, Browserless and Tilion presets use native solving and a US proxy", async () => {
  const requests = [], creations = [], stopped = [];
  class Hyperbrowser {
    constructor(options) {
      assert.equal(options.apiKey, "hb-key");
      this.sessions = { create: async body => { creations.push(body); return { id: "hb-id", wsEndpoint: "wss://hb.example" }; },
        stop: async id => { stopped.push(id); } };
    }
  }
  const env = { HYPERBROWSER_API_KEY: "hb-key", ANCHORBROWSER_API_KEY: "anchor-key", BROWSERLESS_API_KEY: "bl-key", TILION_API_KEY: "tilion-key" };
  let tilionRegion = "us";
  const create = createProviders(() => ({ Hyperbrowser }), env, async (url, options) => {
    requests.push({ url, options, body: options.body && JSON.parse(options.body) });
    if (options.method === "DELETE") return new Response(null, { status: url.includes("tilion") ? 404 : 204 });
    return url.includes("anchorbrowser") ? response({ data: { id: "anchor-id", cdp_url: "wss://anchor.example" } })
      : response({ session_id: "tilion-id", connect_url: "ws://tilion.example/cdp?token=t", region: tilionRegion });
  });

  const hyper = await create("hyperbrowser");
  assert.deepEqual([hyper.id, hyper.cdpUrl], ["hb-id", "wss://hb.example"]);
  assert.deepEqual(creations[0], { solveCaptchas: true, useProxy: true, proxyCountry: "US", region: "us-east", adblock: false, timeoutMinutes: 5 });
  await hyper.release(); assert.deepEqual(stopped, ["hb-id"]);

  const anchor = await create("anchorbrowser");
  assert.deepEqual([anchor.id, anchor.cdpUrl], ["anchor-id", "wss://anchor.example"]);
  const anchorCreate = requests.find(r => r.url === "https://api.anchorbrowser.io/v1/sessions");
  assert.equal(anchorCreate.options.headers["anchor-api-key"], "anchor-key");
  assert.equal(anchorCreate.body.browser.captcha_solver.active, true);
  assert.deepEqual(anchorCreate.body.session.proxy, { active: true, type: "anchor_proxy", country_code: "us" });
  await anchor.release();
  assert.ok(requests.some(r => r.options.method === "DELETE" && r.url.endsWith("/v1/sessions/anchor-id")));

  const browserless = await create("browserless");
  const url = new URL(browserless.cdpUrl);
  assert.equal(`${url.origin}${url.pathname}`, "wss://production-sfo.browserless.io/stealth");
  assert.deepEqual(Object.fromEntries(url.searchParams), { token: "bl-key", proxy: "residential", proxyCountry: "us", solveCaptchas: "true", timeout: "300000" });
  assert.match(browserless.id, /^browserless-[0-9a-f-]{36}$/);
  assert.notEqual((await create("browserless")).id, browserless.id);
  assert.doesNotMatch(JSON.stringify(browserless.configuration), /bl-key/);
  await browserless.release();

  const tilion = await create("tilion");
  assert.deepEqual([tilion.id, tilion.cdpUrl], ["tilion-id", "wss://tilion.example/cdp?token=t"]);
  const tilionCreate = requests.find(r => r.url === "https://api.tilion.dev/v1/session");
  assert.equal(tilionCreate.options.headers.Authorization, "Bearer tilion-key");
  assert.deepEqual(tilionCreate.body, { residential: true, region: "us", cdp_observe: true, ttl: 300 });
  await tilion.release(); // A session that already ended answers 404.
  tilionRegion = "de";
  const before = requests.filter(r => r.options.method === "DELETE").length;
  const wrongRegion = await create("tilion");
  assert.equal(wrongRegion.id, "tilion-id");
  assert.match(wrongRegion.rejected, /region de instead of us/);
  // Through attempt(): an error for this cell, the session released, the campaign not halted.
  const h = harness();
  h.deps.create = async () => wrongRegion;
  const row = await attempt({ ...h.task, provider: "tilion" }, config, h.deps);
  assert.equal(row.status, "error"); assert.match(row.error, /region de instead of us/);
  assert.equal(row.session_id, "tilion-id"); assert.equal(row.cleanup.released, true);
  assert.equal(row.ownership_unknown, undefined); assert.equal(row.halt_campaign, false);
  assert.equal(requests.filter(r => r.options.method === "DELETE").length, before + 1, "A wrong-region session is released");

  for (const provider of config.providers) assert.ok(REQUIRED_ENV[provider]?.length, provider);
});

test("HTML evidence escapes script payloads and labels partial campaigns", () => {
  const html = report(config, [{ id: "x", provider: "notte", type: "hcaptcha", round: 1,
    status: "error", error: "</script><script>bad()</script>" }], false);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
  assert.match(html, /Campaign incomplete/);
  assert.match(html, /95% Wilson/);
  assert.match(html, /reCAPTCHA v3<br><small>Server acceptance/);
  assert.match(html, /Text CAPTCHA<br><small>Page check/);
  assert.match(html, /PerimeterX<br><small>Page reached/);
  assert.match(html, /never by a server/);
  assert.match(report(configuration({ version: 3 }), [], true), /hCaptcha<br><small>Token delivery only/);
});

test("Turnstile records timely acceptance immediately without another page probe", async () => {
  for (const beforeToken of [0, 170_000]) {
    const h = harness(); h.task.fixture = FIXTURES[0];
    let probes = 0;
    h.deps.probe = async () => {
      probes++;
      if (probes === 2) await h.deps.sleep(beforeToken);
      if (probes > 2) { await h.deps.sleep(2_000); throw new Error("Unnecessary page probe"); }
      return { formPresent: true, tokenPresent: true };
    };
    const verificationTime = beforeToken ? 9_000 : 14_000;
    h.deps.verify = async () => {
      await h.deps.sleep(verificationTime);
      return { httpStatus: 200, success: true, testSecret: false, hostname: "zerocaptcha.io", widget: "managed" };
    };
    const row = await attempt(h.task, config, h.deps);
    assert.equal(row.status, "verified");
    assert.equal(row.accepted_ms, 100 + beforeToken + verificationTime);
    assert.equal(probes, 2);
    assert.equal(row.cleanup.released, true);
  }
});

test("Turnstile still rejects late verdicts and preserves server rejection", async () => {
  for (const [delay, success, expected] of [[15_001, true, "error"], [180_001, true, "timeout"], [100, false, "rejected"]]) {
    const h = harness(); h.task.fixture = FIXTURES[0];
    h.deps.verify = async () => {
      await h.deps.sleep(delay);
      return { httpStatus: 200, success, testSecret: false, hostname: "zerocaptcha.io", widget: "managed" };
    };
    const row = await attempt(h.task, config, h.deps);
    assert.equal(row.status, expected);
    assert.equal(row.accepted_ms, null);
    assert.equal(row.cleanup.released, true);
  }
});
