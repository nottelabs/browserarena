import { acceptedOfficial, acceptedTurnstile, deliveredNopecha, schedule } from "./protocol.mjs";

export async function bounded(work, ms = 10_000) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operation exceeded ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export function installCancellation(controller, source = process) {
  const stop = () => controller.abort(new Error("Campaign interrupted"));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) source.on(signal, stop);
  return () => { for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) source.off(signal, stop); };
}

export async function observe(page, fixture) {
  return bounded(page.evaluate(fixture => {
    const text = document.body?.innerText ?? "";
    const tokens = [...document.querySelectorAll(fixture.token)].map(input => ({
      length: input.value.length, dummy: input.value.includes("DUMMY"),
    }));
    const accepted = fixture.type === "recaptcha" && /Verification Success/i.test(text);
    return { title: document.title, formPresent: !!document.querySelector(fixture.form), accepted,
      callbackSuccess: fixture.result ? document.querySelector(fixture.result)?.textContent?.trim() === "success" : false,
      rejected: /Verification Failed|Your response was invalid/i.test(text),
      tokens, tokenPresent: tokens.some(t => t.length > 20 && !t.dummy),
      sitekeys: [...document.querySelectorAll("[data-sitekey]")].map(e => e.getAttribute("data-sitekey")),
    };
  }, fixture));
}

export async function submit(page, fixture, timeout = 15_000) {
  if (fixture.type === "hcaptcha") throw new Error("NopeCHA has no server acceptance verifier; observe token delivery instead");
  if (fixture.type !== "turnstile") {
    await Promise.all([
      page.waitForEvent("domcontentloaded", { timeout }),
      bounded(page.locator(fixture.form).evaluate(form => form.requestSubmit()), timeout),
    ]);
    return null;
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

// A fresh, independently released session for every planned cell. Provider-reported
// success is diagnostic; only the external verifier can set status=verified.
export async function attempt(task, config, deps) {
  const { create, chromium, clean, journal = async () => {}, signal,
    now = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
    probe = observe, verify = submit, screenshot = async () => {} } = deps;
  const started = now();
  const row = { id: task.id, round: task.round, provider: task.provider, type: task.fixture.type,
    url: task.fixture.url, started_at: new Date().toISOString(), status: "error", stage: "create",
    session_id: null, accepted_ms: null, cleanup: { released: false, disconnected: false } };
  let session, browser, page, navigationStart, deadline, verificationDeadline = null, createStarted = false;
  let receipt = null;
  const progress = async event => {
    try { await journal(event); }
    catch (error) { row.journal_error = clean(error); throw error; }
  };
  const onResponse = response => {
    if (response.url() === task.fixture.url && response.request().method() === "POST")
      receipt = { method: "POST", url: task.fixture.url, httpStatus: response.status() };
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
    if (!response || response.status() >= 400) throw new Error(`Fixture navigation HTTP ${response?.status() ?? "missing"}`);
    row.initial = await probe(page, task.fixture);
    if (!row.initial.formPresent && !acceptedOfficial(row.initial, receipt, task.fixture))
      throw new Error("Expected fixture form missing");
    row.stage = "solve";
    row.solve_start_ms = now() - navigationStart;
    deadline = now() + config.solveTimeoutMs;
    let submitted = false;
    while (now() < deadline && !signal?.aborted) {
      const remaining = Math.min(deadline, verificationDeadline ?? deadline) - now();
      const state = await bounded(probe(page, task.fixture), Math.min(10_000, Math.max(1, remaining)));
      row.final = state;
      if (now() >= deadline) break;
      if (verificationDeadline !== null && now() >= verificationDeadline)
        throw new Error("No independent verification verdict within 15s of submission");
      if (task.fixture.type === "hcaptcha" && deliveredNopecha(state)) {
        row.status = "token_delivered";
        row.token_ms = now() - navigationStart;
        row.verification = { kind: "widget_callback", serverAcceptanceVerified: false };
        break;
      }
      if (task.fixture.type === "turnstile" ? acceptedTurnstile(row.verification)
        : acceptedOfficial(state, receipt, task.fixture)) {
        row.status = "verified";
        row.accepted_ms = now() - navigationStart;
        break;
      }
      if (submitted && (state.rejected || row.verification && !acceptedTurnstile(row.verification))) {
        row.status = "rejected";
        break;
      }
      if (task.fixture.type !== "hcaptcha" && state.tokenPresent && !submitted) {
        row.token_ms = now() - navigationStart;
        submitted = true;
        row.stage = "verify";
        verificationDeadline = Math.min(deadline, now() + 15_000);
        const budget = Math.max(1, Math.floor(verificationDeadline - now()));
        row.verification = await bounded(verify(page, task.fixture, budget), budget);
        if (task.fixture.type === "turnstile") {
          // The returned server verdict is the evidence. A later page probe
          // must neither delay its timestamp nor turn timely acceptance into failure.
          const verifiedAt = now();
          if (verifiedAt >= deadline) break;
          if (verifiedAt >= verificationDeadline)
            throw new Error("No independent verification verdict within 15s of submission");
          if (!row.verification) throw new Error("Missing Turnstile verification verdict");
          row.status = acceptedTurnstile(row.verification) ? "verified" : "rejected";
          if (row.status === "verified") row.accepted_ms = verifiedAt - navigationStart;
          break;
        }
        continue;
      }
      await sleep(Math.min(1_000, Math.max(0, deadline - now())));
    }
    if (!["verified", "token_delivered", "rejected"].includes(row.status)) row.status = signal?.aborted ? "interrupted" : "timeout";
    row.external_receipt = receipt;
    row.elapsed_ms = now() - navigationStart;
  } catch (error) {
    row.status = signal?.aborted ? "interrupted" : deadline !== undefined && now() >= deadline ? "timeout" : "error";
    row.error = clean(error);
    if (createStarted && row.stage === "create" && !row.session_id) row.ownership_unknown = true;
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
      catch (error) { row.cleanup.error = clean(error); }
    }
    if (browser) {
      try { await bounded(browser.close(), 15_000); row.cleanup.disconnected = true; }
      catch (error) { row.cleanup.disconnect_error = clean(error); }
    }
    row.total_ms = now() - started;
    row.finished_at = new Date().toISOString();
    row.halt_campaign = !!row.ownership_unknown || !!row.journal_error || !!row.session_id && !row.cleanup.released || !!browser && !row.cleanup.disconnected;
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
