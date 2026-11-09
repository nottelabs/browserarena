import { acceptedGeetest, acceptedOfficial, acceptedRecaptchaV3, acceptedTurnstile, parseSiteverifyDump, passedText,
  reachedPerimeterX, schedule } from "./protocol.mjs";

class BoundExceeded extends Error {}
// A fixture that no longer matches its pinned contract. It stops the campaign so a
// changed demo is never published as provider failures.
class FixtureDrift extends Error {}

export async function bounded(work, ms = 10_000) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new BoundExceeded(`Operation exceeded ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export function installCancellation(controller, source = process) {
  const stop = () => controller.abort(new Error("Campaign interrupted"));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) source.on(signal, stop);
  return () => { for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) source.off(signal, stop); };
}

// Read-only page facts. Probes never click a widget, read a solution or write an answer.
export async function observe(page, fixture) {
  const state = await bounded(page.evaluate(fixture => {
    const text = document.body?.innerText ?? "";
    const visible = element => {
      const box = element.getBoundingClientRect();
      return element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false && box.width > 0 && box.height > 0;
    };
    const form = fixture.form ? document.querySelector(fixture.form) : null;
    const tokens = fixture.token ? [...document.querySelectorAll(fixture.token)].map(input => ({
      length: input.value.length, dummy: input.value.includes("DUMMY"),
    })) : [];
    const state = { title: document.title, url: location.href, formPresent: !!form,
      accepted: fixture.type === "recaptcha" && /Verification Success/i.test(text),
      rejected: /Verification Failed|Your response was invalid/i.test(text),
      tokens, tokenPresent: tokens.some(t => t.length > 20 && !t.dummy),
      sitekeys: [...document.querySelectorAll("[data-sitekey]")].map(e => e.getAttribute("data-sitekey")), drift: null };
    if (fixture.type === "hcaptcha") {
      // Parsed outside the page; the printed text also echoes the submitted token.
      state.siteverifyText = (document.body?.textContent ?? "").includes('["success"]=>') ? document.body.textContent : null;
      if ([...document.querySelectorAll(".h-captcha[data-sitekey]")].some(e => e.getAttribute("data-sitekey") !== fixture.sitekey))
        state.drift = "hCaptcha sitekey changed";
    } else if (fixture.type === "recaptcha-v3") {
      const scripts = [...document.scripts].map(script => script.src).filter(src => /\/recaptcha\/(api|enterprise)\.js/.test(src));
      const pinned = scripts.some(src => new URL(src).searchParams.get("render") === fixture.sitekey);
      state.ready = !!form && pinned && typeof window.grecaptcha?.execute === "function";
      if (scripts.length && !pinned) state.drift = "reCAPTCHA v3 sitekey changed";
      state.rejected = false;
    } else if (fixture.type === "geetest") {
      const value = name => form?.querySelector(`input[name="${name}"]`)?.value ?? "";
      state.tokenPresent = value("geetest_validate").length >= 20 && !!value("geetest_challenge") && !!value("geetest_seccode");
      state.rejected = false;
    } else if (fixture.type === "text") {
      const input = form?.querySelector(fixture.token), image = form?.querySelector(fixture.image);
      state.formPresent = !!input;
      state.imageReady = !!image && image.complete && image.naturalWidth > 0;
      state.answer = input?.value ?? "";
      state.tokenPresent = state.answer.trim().length > 0;
      state.passed = !!form && form.innerText.includes(fixture.passed);
      state.failed = text.includes(fixture.failed);
      state.rejected = state.failed;
    } else if (fixture.type === "perimeterx") {
      state.formPresent = location.origin === new URL(fixture.url).origin;
      state.appId = typeof window._pxAppId === "string" ? window._pxAppId : null;
      state.challenge = location.pathname === "/blocked" || [...document.querySelectorAll(fixture.challenge)].some(visible);
      state.products = [...document.links].filter(link => visible(link) && /^\/ip\//.test(new URL(link.href, location.href).pathname)).length;
      state.searchReady = /Results for/.test(text) && state.products > 0;
      state.rejected = false;
    }
    return state;
  }, fixture));
  if (fixture.type === "hcaptcha") {
    const siteverify = parseSiteverifyDump(state.siteverifyText);
    delete state.siteverifyText;
    if (siteverify) state.siteverify = siteverify;
    state.rejected = !!siteverify && !(siteverify.success === true && siteverify.hostname === fixture.hostname);
  }
  return state;
}

const submitForm = (page, fixture, timeout) => bounded(page.locator(fixture.form).evaluate(form => form.requestSubmit()), timeout);

export async function submit(page, fixture, timeout = 15_000) {
  if (fixture.type === "perimeterx") throw new Error("PerimeterX has no submission; observe the page instead");
  if (fixture.type === "recaptcha" || fixture.type === "hcaptcha") {
    await Promise.all([page.waitForEvent("domcontentloaded", { timeout }), submitForm(page, fixture, timeout)]);
    return null;
  }
  if (fixture.type === "text") { await submitForm(page, fixture, timeout); return null; }
  if (fixture.type === "recaptcha-v3") {
    // The page's own submit handler requests the token and calls its verifier.
    const verifier = new URL(fixture.verifier, fixture.url).href;
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url() === verifier && r.request().method() === "POST", { timeout }),
      submitForm(page, fixture, timeout),
    ]);
    const result = await bounded(response.json(), timeout);
    return { httpStatus: response.status(), success: result.success, hostname: result.hostname,
      action: result.action, score: result.score, errorCodes: result["error-codes"] };
  }
  if (fixture.type === "geetest") {
    return bounded(page.evaluate(async ({ fixture, timeout }) => {
      const form = document.querySelector(fixture.form);
      const value = name => form?.querySelector(`input[name="${name}"]`)?.value ?? "";
      const response = await fetch(fixture.verifier, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ geetest_challenge: value("geetest_challenge"), geetest_validate: value("geetest_validate"),
          geetest_seccode: value("geetest_seccode") }), signal: AbortSignal.timeout(timeout), redirect: "error" });
      const result = await response.json();
      return { httpStatus: response.status, success: result.success };
    }, { fixture, timeout }), timeout);
  }
  return bounded(page.evaluate(async ({ fixture, timeout }) => {
    const token = document.querySelector(fixture.token)?.value;
    const response = await fetch(fixture.verifier, { method: "POST", headers: {
      "content-type": "application/json", "x-zerocaptcha-client": "web",
    }, body: JSON.stringify({ widget: "managed", token }), signal: AbortSignal.timeout(timeout), redirect: "error" });
    const result = await response.json();
    return { httpStatus: response.status, success: result.success, testSecret: result.testSecret,
      hostname: result.hostname, widget: result.widget, errorCodes: result.errorCodes };
  }, { fixture, timeout }), timeout);
}

// Types whose verifier returns its verdict directly to the harness.
const VERDICTS = {
  turnstile: verdict => acceptedTurnstile(verdict),
  "recaptcha-v3": (verdict, fixture) => acceptedRecaptchaV3(verdict, fixture),
  geetest: (verdict, fixture, init) => acceptedGeetest(verdict, init, fixture),
};

// A fresh, independently released session for every planned cell. Provider-reported
// success is diagnostic; only the external verifier can set status=verified.
// A provider that answers session creation with a 4xx status (other than 408, a
// timeout) refused it: no session exists, so nothing can be left running. Quota,
// credit and auth refusals then count against that attempt instead of halting the
// campaign. Lost responses, timeouts and 5xx stay ambiguous and still halt.
export function refusedCreate(error) {
  const status = error?.status ?? error?.statusCode;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408;
}

// A release that fails (a slow or lost reply) does not mean the session runs on:
// on 2026-11-07 Anchor ended a session but answered its DELETE after 30 s, which
// halted the campaign and blocked the next day. Before counting the session as
// unreleased, ask the provider whether it ended, retry the release once, and ask
// again. Only a provider answer that the session ended, or a successful release,
// counts; anything else still halts.
export const RELEASE_RETRY_DELAY_MS = 5_000;

async function recoverRelease(session, row, { clean, sleep }) {
  const ended = async () => {
    if (!session.ended) return false;
    try { return await bounded(session.ended(), 15_000) === true; }
    catch (error) { row.cleanup.status_error = clean(error); return false; }
  };
  if (await ended()) { row.cleanup.recovered = "status"; return true; }
  await sleep(RELEASE_RETRY_DELAY_MS);
  try { await session.release(); row.cleanup.recovered = "retry"; return true; }
  catch (error) { row.cleanup.retry_error = clean(error); }
  if (await ended()) { row.cleanup.recovered = "status"; return true; }
  return false;
}

export async function attempt(task, config, deps) {
  const { create, chromium, clean, journal = async () => {}, signal,
    now = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
    probe = observe, verify = submit, screenshot = async () => {} } = deps;
  const started = now();
  const row = { id: task.id, round: task.round, provider: task.provider, type: task.fixture.type,
    url: task.fixture.url, started_at: new Date().toISOString(), status: "error", stage: "create",
    session_id: null, accepted_ms: null, passed_ms: null, cleanup: { released: false, disconnected: false } };
  let session, browser, page, navigationStart, deadline, verificationDeadline = null, createStarted = false;
  let receipt = null, init = null;
  const fixture = task.fixture, judge = VERDICTS[fixture.type];
  const progress = async event => {
    try { await journal(event); }
    catch (error) { row.journal_error = clean(error); throw error; }
  };
  const onResponse = response => {
    if (response.url() === fixture.url && response.request().method() === "POST")
      receipt = { method: "POST", url: fixture.url, httpStatus: response.status() };
    // GeeTest's offline mode validates locally; only an online init counts.
    if (fixture.init && response.url().startsWith(new URL(fixture.init, fixture.url).href))
      response.json().then(body => { init = { online: body?.success === 1, gt: body?.gt ?? null }; },
        () => { init = { online: false, gt: null }; });
  };
  try {
    await progress({ event: "attempt_started", id: task.id, provider: task.provider, type: task.fixture.type });
    signal?.throwIfAborted();
    // Do not cancel creation on a campaign signal: recover the owned ID first.
    createStarted = true;
    session = await create(task.provider);
    if (typeof session.id === "string" && session.id) row.session_id = session.id;
    row.configuration = session.configuration;
    await progress({ event: "session_created", id: task.id, session_id: row.session_id });
    // An adapter may refuse a session it owns (e.g. a wrong region); the ID is
    // recorded above, so cleanup below still releases it.
    if (typeof session.rejected === "string") throw new Error(session.rejected);
    if (!row.session_id || typeof session.cdpUrl !== "string" || !/^wss?:\/\//.test(session.cdpUrl))
      throw new Error("Create returned an invalid session ID or CDP URL");
    signal?.throwIfAborted();
    row.stage = "connect";
    browser = await chromium.connectOverCDP(session.cdpUrl, { timeout: 30_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Provider supplied no browser context");
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.setViewportSize(config.viewport);
    page.on("response", onResponse);
    signal?.throwIfAborted();
    row.stage = "navigate";
    navigationStart = now();
    const response = await page.goto(task.fixture.url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    row.navigation_http_status = response?.status() ?? null;
    // Walmart may answer with its PerimeterX block page; that is the challenge, not a failure.
    if (!response || response.status() >= 400 && fixture.type !== "perimeterx") throw new Error(`Fixture navigation HTTP ${response?.status() ?? "missing"}`);
    row.initial = await probe(page, task.fixture);
    if (!row.initial.formPresent && !acceptedOfficial(row.initial, receipt, task.fixture))
      throw new Error("Expected fixture form missing");
    // A solver may type during navigation; only a verdict before any submission is stale.
    if (fixture.type === "text" && row.initial.passed)
      throw new Error("Text CAPTCHA demo is not a fresh challenge");
    row.stage = "solve";
    row.solve_start_ms = now() - navigationStart;
    deadline = now() + config.solveTimeoutMs;
    let submitted = false, previous = null, clearSince = null;
    while (now() < deadline && !signal?.aborted) {
      const windowEnd = Math.min(deadline, verificationDeadline ?? deadline);
      const remaining = windowEnd - now();
      let state = null;
      try {
        state = await bounded(probe(page, fixture), Math.min(10_000, Math.max(1, remaining)));
      } catch (error) {
        // A probe cut off by the end of its window is that window ending, not a page failure.
        if (!(error instanceof BoundExceeded) || remaining >= 10_000) throw error;
      }
      if (state) row.final = state;
      if (now() >= deadline || (!state && windowEnd >= deadline)) break;
      if (verificationDeadline !== null && (!state || now() >= verificationDeadline))
        throw new Error("No independent verification verdict within 15s of submission");
      if (state.drift) throw new FixtureDrift(`Fixture drift: ${state.drift}`);
      if (fixture.type === "perimeterx") {
        // Usable results must hold for a few seconds; a challenge or block resets the clock.
        if (state.challenge) row.challenge_seen = true;
        if (reachedPerimeterX(state, fixture)) {
          clearSince ??= now();
          if (now() - clearSince >= fixture.stableMs) {
            row.status = "page_passed";
            row.passed_ms = clearSince - navigationStart;
            break;
          }
        } else clearSince = null;
        await sleep(Math.min(1_000, Math.max(0, deadline - now())));
        continue;
      }
      if (fixture.type === "text" && submitted && passedText(state)) {
        row.status = "page_passed";
        row.passed_ms = now() - navigationStart;
        break;
      }
      if (fixture.type === "turnstile" ? acceptedTurnstile(row.verification)
        : acceptedOfficial(state, receipt, fixture)) {
        row.status = "verified";
        row.accepted_ms = now() - navigationStart;
        break;
      }
      if (submitted && (state.rejected || row.verification && judge && !judge(row.verification, fixture, init))) {
        row.status = "rejected";
        break;
      }
      // reCAPTCHA v3 has no widget output before submission; the text answer must stop changing.
      const ready = fixture.type === "recaptcha-v3" ? state.ready === true
        : fixture.type === "text" ? state.tokenPresent && state.imageReady && previous?.answer === state.answer
          : state.tokenPresent;
      if (ready && !submitted) {
        if (fixture.type !== "recaptcha-v3") row.token_ms = now() - navigationStart;
        // A public demo's fixed answer; kept privately to tell a wrong answer from one the page never registered.
        if (fixture.type === "text") row.submitted_answer = state.answer;
        submitted = true;
        row.stage = "verify";
        verificationDeadline = Math.min(deadline, now() + 15_000);
        const budget = Math.max(1, Math.floor(verificationDeadline - now()));
        row.verification = await bounded(verify(page, fixture, budget), budget);
        if (judge) {
          // The returned server verdict is the evidence. A later page probe
          // must neither delay its timestamp nor turn timely acceptance into failure.
          const verifiedAt = now();
          if (verifiedAt >= deadline) break;
          if (verifiedAt >= verificationDeadline)
            throw new Error("No independent verification verdict within 15s of submission");
          if (!row.verification) throw new Error(`Missing ${fixture.type} verification verdict`);
          if (fixture.init && !init) throw new Error("GeeTest init parameters were not observed");
          if (fixture.init && init.gt !== fixture.gt) throw new FixtureDrift("Fixture drift: GeeTest gt changed");
          row.status = judge(row.verification, fixture, init) ? "verified" : "rejected";
          if (row.status === "verified") row.accepted_ms = verifiedAt - navigationStart;
          if (fixture.init) row.geetest_init = init;
          break;
        }
        continue;
      }
      previous = state;
      await sleep(Math.min(1_000, Math.max(0, deadline - now())));
    }
    if (!["verified", "token_delivered", "page_passed", "rejected"].includes(row.status)) row.status = signal?.aborted ? "interrupted" : "timeout";
    row.external_receipt = receipt;
    row.elapsed_ms = now() - navigationStart;
  } catch (error) {
    row.status = signal?.aborted ? "interrupted" : deadline !== undefined && now() >= deadline ? "timeout" : "error";
    if (error instanceof FixtureDrift) row.fixture_drift = true;
    row.error = clean(error);
    if (createStarted && row.stage === "create" && !row.session_id) {
      if (refusedCreate(error)) row.create_refused = true;
      else row.ownership_unknown = true;
    }
  } finally {
    row.external_receipt = receipt;
    if (page) {
      try { await screenshot(page, task, row); }
      catch (error) { row.screenshot_error = clean(error); }
      page.off("response", onResponse);
    }
    if (session?.diagnostics && row.status !== "verified") {
      try {
        const data = await session.diagnostics();
        // Explicit allowlist: provider responses may grow solution/token fields.
        row.provider_diagnostics = Array.isArray(data) ? data.map(state => ({
          isSolvingCaptcha: state.isSolvingCaptcha === true,
          tasks: Array.isArray(state.tasks) ? state.tasks.map(task => Object.fromEntries(
            ["type", "status", "totalDuration", "validationResult"].filter(key => task[key] !== undefined)
              .map(key => [key, typeof task[key] === "string" ? clean(task[key]) : task[key]]),
          )) : [],
        })) : { invalid_shape: true };
      } catch (error) { row.provider_diagnostics_error = clean(error); }
    }
    if (row.session_id) {
      try { await session.release(); row.cleanup.released = true; }
      catch (error) {
        row.cleanup.error = clean(error);
        row.cleanup.released = await recoverRelease(session, row, { clean, sleep });
      }
    }
    if (browser) {
      try { await bounded(browser.close(), 15_000); row.cleanup.disconnected = true; }
      catch (error) { row.cleanup.disconnect_error = clean(error); }
    }
    row.total_ms = now() - started;
    row.finished_at = new Date().toISOString();
    row.halt_campaign = !!row.fixture_drift || !!row.ownership_unknown || !!row.journal_error || !!row.session_id && !row.cleanup.released || !!browser && !row.cleanup.disconnected;
  }
  return row;
}

export async function runSuite(config, { runAttempt, save, sleep = ms => new Promise(r => setTimeout(r, ms)), signal }) {
  const pending = schedule(config).flat(), rows = [], active = new Set(), waiters = new Set();
  let halted = false;
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  async function worker() {
    while (pending.length && !halted && !signal?.aborted) {
      const index = pending.findIndex(task => !active.has(task.provider));
      if (index === -1) { await new Promise(resolve => waiters.add(resolve)); continue; }
      const [task] = pending.splice(index, 1);
      active.add(task.provider);
      try {
        const row = await runAttempt(task);
        rows.push(row);
        if (row.halt_campaign) halted = true;
        await save(row);
        // Keep the provider occupied during its post-cleanup cooldown.
        if (!halted && !signal?.aborted) await sleep(config.cooldownMs);
      } catch (error) { halted = true; throw error; }
      finally { active.delete(task.provider); wake(); }
    }
  }
  const workers = await Promise.allSettled(Array.from({ length: config.concurrency }, worker));
  const failure = workers.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  return { rows, halted, not_run: pending.map(task => ({ id: task.id, round: task.round, provider: task.provider, type: task.fixture.type })) };
}
