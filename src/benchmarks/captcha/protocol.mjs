// Providers with a native CAPTCHA solver. Providers without one are listed, with the
// reason, in web/lib/captcha-data.ts and are never run.
export const PROVIDERS = ["kernel", "browserbase", "browser-use", "steel", "notte",
  "hyperbrowser", "anchorbrowser", "browserless", "tilion"];
// Run by the daily publisher (scripts/run-captcha-and-publish.sh). Left out until
// their accounts can serve a daily campaign:
// - tilion: no TILION_API_KEY on the US West runner, so preflight fails;
// - hyperbrowser: out of credits ("You have reached your credit limit");
// - browserless: free-plan usage cap reached (every connect returns 401).
// They stay benchmarked and keep their "No results yet" row on /captcha.
export const DAILY_EXCLUDED = ["tilion", "hyperbrowser", "browserless"];
export const DAILY_PROVIDERS = PROVIDERS.filter(provider => !DAILY_EXCLUDED.includes(provider));
export const PROTOCOL_VERSION = 5;

// What a success means for a type. The status a success records follows from it,
// so a page-level pass or token delivery can never be shown as server acceptance.
export const SIGNALS = {
  server_acceptance: { label: "Server acceptance", status: "verified" },
  token_delivery: { label: "Token delivery only", status: "token_delivered" },
  page_check: { label: "Page check", status: "page_passed" },
  page_reached: { label: "Page reached", status: "page_passed" },
};
export const TYPE_LABELS = {
  turnstile: "Cloudflare Turnstile", recaptcha: "reCAPTCHA v2", hcaptcha: "hCaptcha",
  "recaptcha-v3": "reCAPTCHA v3", geetest: "GeeTest v3", text: "Text CAPTCHA", perimeterx: "PerimeterX",
};

const TURNSTILE = { type: "turnstile", url: "https://zerocaptcha.io/captcha-test/cloudflare-turnstile-managed",
  form: "form[data-demo-form]", token: 'input[name="cf-turnstile-response"]',
  sitekey: "0x4AAAAAAFMVDQUY9ZAPO0ni", verifier: "/api/v1/demo/verify" };
const RECAPTCHA = { type: "recaptcha", url: "https://www.google.com/recaptcha/api2/demo",
  form: "#recaptcha-demo-form", token: 'textarea[name="g-recaptcha-response"]',
  sitekey: "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-" };

// Protocol v3, kept exactly as published so its campaigns still validate and display.
// NopeCHA has blocked every visitor with a Cloudflare 403 since 2026-11-05.
export const V3_FIXTURES = [TURNSTILE, RECAPTCHA,
  { type: "hcaptcha", url: "https://nopecha.com/captcha/hcaptcha#enterprise",
    form: ".cell", token: 'textarea[name="h-captcha-response"]', result: "#token_3",
    script: "/js/demo/hcaptcha.js?v=2", sitekey: "58366d97-3e8c-4b57-a679-4a41c8423be3" }];
const V3_SIGNALS = { turnstile: "server_acceptance", recaptcha: "server_acceptance", hcaptcha: "token_delivery" };

const V4_ADDED_TYPES = [
  // The page's Check button calls grecaptcha.execute and sends the token to a
  // same-origin verifier that returns Google's siteverify result, including the score.
  { type: "recaptcha-v3", url: "https://2captcha.com/demo/recaptcha-v3", form: 'form:has(button[data-action="demo_action"])',
    sitekey: "6Lcyqq8oAAAAAJE7eVJ3aZp_hnJcI6LgGdYD8lge", verifier: "/api/v1/captcha-demo/recaptcha/verify",
    hostname: "2captcha.com", action: "demo_action", minScore: 0.5, signal: "server_acceptance" },
  // GeeTest v3 fills three hidden inputs; a same-origin verifier validates them with GeeTest.
  { type: "geetest", url: "https://2captcha.com/demo/geetest", form: "#geetest-demo-form",
    token: 'input[name="geetest_validate"]', gt: "81388ea1fc187e0c335c0a8907ff2625",
    init: "/api/v1/captcha-demo/gee-test/init-params", verifier: "/api/v1/captcha-demo/gee-test/verify",
    signal: "server_acceptance" },
  // The demo compares the answer with a fixed string in the browser. No server sees it.
  { type: "text", url: "https://2captcha.com/demo/normal", form: "form:has(#simple-captcha-field)",
    token: "#simple-captcha-field", image: 'img[alt="normal captcha example"]',
    passed: "Captcha is passed successfully!", failed: "Incorrect captcha answer, please try again.",
    signal: "page_check" },
  // No token exists: success is reaching usable search results with no visible challenge.
  { type: "perimeterx", url: "https://www.walmart.com/search?q=desk+lamp", appId: "PXu6b0qd2S",
    challenge: "#px-captcha", stableMs: 5_000, signal: "page_reached" },
];

// Protocol v4, kept exactly as published so its campaigns still validate and display.
// Anti-Captcha refuses every task on hcaptcha.com ("Not valid domain hcaptcha.com",
// 2026-11-06), so a solver built on it can never pass hCaptcha's own demo.
export const V4_FIXTURES = [
  { ...TURNSTILE, signal: "server_acceptance" },
  { ...RECAPTCHA, signal: "server_acceptance" },
  // hCaptcha's own demo posts the form and prints its siteverify response.
  { type: "hcaptcha", url: "https://accounts.hcaptcha.com/demo", form: "#hcaptcha-demo-form",
    token: 'textarea[name="h-captcha-response"]', sitekey: "a5f74b19-9e45-40e0-b45d-47ff91b7a6c2",
    // Siteverify reports the registered site, hcaptcha.com, not the demo subdomain.
    hostname: "hcaptcha.com", signal: "server_acceptance" },
  ...V4_ADDED_TYPES,
];

export const FIXTURES = [
  { ...TURNSTILE, signal: "server_acceptance" },
  { ...RECAPTCHA, signal: "server_acceptance" },
  // Anti-Captcha's demo form posts to its own URL and prints hCaptcha's siteverify
  // response as a PHP var_dump. Its secret is real: the test token fails.
  { type: "hcaptcha", url: "https://democaptcha.com/demo-form-eng/hcaptcha.html", form: 'form[name="hcaptcha_demo_form"]',
    token: 'textarea[name="h-captcha-response"]', sitekey: "338af34c-7bcb-4c7c-900b-acbec73d7d43",
    hostname: "democaptcha.com", signal: "server_acceptance" },
  ...V4_ADDED_TYPES,
];

export function fixturesFor(version) {
  if (version === 3) return V3_FIXTURES;
  if (version === 4) return V4_FIXTURES;
  if (version === 5) return FIXTURES;
  throw new Error(`Unsupported CAPTCHA protocol version: ${version}`);
}
export function signalFor(version, type) {
  const signal = version === 3 ? V3_SIGNALS[type] : fixturesFor(version).find(f => f.type === type)?.signal;
  if (!signal) throw new Error(`Unknown CAPTCHA type for protocol v${version}: ${type}`);
  return signal;
}
// Column metadata for the page and API, in plan order.
export function captchaTypes(version) {
  return fixturesFor(version).map(({ type }) => {
    const signal = signalFor(version, type);
    return { id: type, label: TYPE_LABELS[type], signal, signal_label: SIGNALS[signal].label };
  });
}

export function configuration(input = {}) {
  const config = { version: PROTOCOL_VERSION, rounds: 5, concurrency: 3, solveTimeoutMs: 180_000,
    cooldownMs: 5_000, providers: PROVIDERS, ...input };
  const fixtures = fixturesFor(config.version);
  if (!Number.isSafeInteger(config.rounds) || config.rounds < 1 || config.rounds > 20)
    throw new Error("rounds must be an integer from 1 through 20");
  if (!Array.isArray(config.providers) || !config.providers.length ||
      new Set(config.providers).size !== config.providers.length ||
      config.providers.some(name => !PROVIDERS.includes(name)))
    throw new Error(`providers must be a unique subset of: ${PROVIDERS.join(", ")}`);
  if (!Number.isSafeInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 3)
    throw new Error("concurrency must be an integer from 1 through 3");
  if (config.solveTimeoutMs !== 180_000 || config.cooldownMs !== 5_000)
    throw new Error(`Protocol v${config.version} fixes the solve window at 180s and cooldown at 5s`);
  const unknown = Object.keys(input).filter(k => !["version", "rounds", "concurrency", "providers", "solveTimeoutMs", "cooldownMs"].includes(k));
  if (unknown.length) throw new Error(`Unknown configuration fields: ${unknown.join(", ")}`);
  return { version: config.version, rounds: config.rounds, providers: [...config.providers],
    concurrency: config.concurrency, solveTimeoutMs: 180_000, cooldownMs: 5_000,
    navigationTimeoutMs: 30_000, viewport: { width: 1920, height: 1080 },
    retries: 0, fixtures: fixtures.map(f => ({ ...f })) };
}

export function schedule(config) {
  const fixtures = config.fixtures;
  return Array.from({ length: config.rounds }, (_, round) => {
    const providers = config.providers.map((_, index) => config.providers[(index + round) % config.providers.length]);
    return providers.flatMap(provider => fixtures.map((_, index) => {
      const fixture = fixtures[(index + round) % fixtures.length];
      return { id: `r${String(round + 1).padStart(2, "0")}-${provider}-${fixture.type}`,
        round: round + 1, provider, fixture };
    }));
  });
}

export function acceptedTurnstile(verdict) {
  return verdict?.httpStatus === 200 && verdict.success === true &&
    verdict.testSecret === false && verdict.hostname === "zerocaptcha.io" && verdict.widget === "managed";
}

// The reCAPTCHA v2 and hCaptcha demos POST the form to their own URL. reCAPTCHA v2
// replaces the form with a success page; the hCaptcha demo prints its siteverify
// response. A query string could switch a demo's secret, so the receipt URL must match exactly.
export function acceptedOfficial(state, receipt, fixture) {
  const posted = receipt?.httpStatus === 200 && receipt.method === "POST" && receipt.url === fixture.url;
  if (fixture.type === "recaptcha") return posted && state?.accepted === true && state.formPresent === false;
  if (fixture.type === "hcaptcha") return posted && state?.siteverify?.success === true &&
    state.siteverify.hostname === fixture.hostname;
  return false;
}

// Google's documented default threshold is 0.5; the demo itself accepts any score.
export function acceptedRecaptchaV3(verdict, fixture) {
  return verdict?.httpStatus === 200 && verdict.success === true && verdict.hostname === fixture.hostname &&
    verdict.action === fixture.action && typeof verdict.score === "number" && verdict.score >= fixture.minScore;
}

// GeeTest's offline fallback validates locally and is not a GeeTest verdict.
export function acceptedGeetest(verdict, init, fixture) {
  return verdict?.httpStatus === 200 && verdict.success === true &&
    init?.online === true && init.gt === fixture.gt;
}

export function passedText(state) {
  return state?.passed === true && state.failed === false;
}

export function reachedPerimeterX(state, fixture) {
  if (!state || state.challenge !== false || state.searchReady !== true || state.appId !== fixture.appId) return false;
  const url = new URL(state.url), target = new URL(fixture.url);
  return url.origin === target.origin && url.pathname === target.pathname &&
    url.searchParams.get("q") === target.searchParams.get("q");
}

export function interval(successes, n) {
  if (!n) return null;
  const z = 1.959963984540054, p = successes / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
}
const TIMING = { verified: "accepted_ms", token_delivered: "token_ms", page_passed: "passed_ms" };

export function summarize(config, rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`Duplicate attempt: ${row.id}`);
    seen.add(row.id);
  }
  return config.providers.flatMap(provider => config.fixtures.map(fixture => {
    const attempts = rows.filter(r => r.provider === provider && r.type === fixture.type);
    const count = status => attempts.filter(r => r.status === status).length;
    const times = status => attempts.filter(r => r.status === status).map(r => r[TIMING[status]]);
    const signal = signalFor(config.version, fixture.type), success = SIGNALS[signal].status;
    return { provider, type: fixture.type, signal, planned: config.rounds, attempted: attempts.length,
      verified: count("verified"), token_delivered: count("token_delivered"), page_passed: count("page_passed"),
      succeeded: count(success), timeout: count("timeout"), rejected: count("rejected"),
      error: count("error"), interrupted: count("interrupted"),
      cleanup_errors: attempts.filter(r => r.session_id && !r.cleanup?.released || r.cleanup?.disconnect_error).length,
      not_run: config.rounds - attempts.length,
      acceptance_interval_95: interval(count("verified"), attempts.length),
      delivery_interval_95: interval(count("token_delivered"), attempts.length),
      success_interval_95: interval(count(success), attempts.length),
      delivered_median_ms: median(times("token_delivered")),
      accepted_median_ms: median(times("verified")),
      success_median_ms: median(times(success)),
      rounds: attempts.map(r => ({ round: r.round, status: r.status, accepted_ms: r.accepted_ms ?? null,
        token_ms: r.token_ms ?? null, passed_ms: r.passed_ms ?? null })),
    };
  }));
}

async function get(request, url, redirect = "error") {
  const response = await request(url, { signal: AbortSignal.timeout(20_000), redirect });
  return { response, text: redirect === "manual" ? "" : await response.text() };
}
async function post(request, url, body, headers = { "content-type": "application/json" }) {
  const target = new URL(url);
  return request(target, { method: "POST", headers: { ...headers, origin: target.origin }, body,
    signal: AbortSignal.timeout(20_000), redirect: "error" });
}
// The democaptcha.com demo prints siteverify's answer as a PHP var_dump:
//   ["success"]=> bool(false)  ["hostname"]=> string(14) "dummy-key-pass"
//   ["error-codes"]=> array(1) { [0]=> string(22) "not-using-dummy-secret" }
// Null when the text holds no verdict; a verdict without a boolean success is invalid.
export function parseSiteverifyDump(text) {
  if (typeof text !== "string" || !text.includes('["success"]=>')) return null;
  const success = /\["success"\]=>\s*bool\((true|false)\)/.exec(text);
  if (!success) return { success: false, invalid: true };
  const hostname = /\["hostname"\]=>\s*string\(\d+\)\s*"([^"]*)"/.exec(text)?.[1];
  const codes = /\["error-codes"\]=>\s*array\(\d+\)\s*\{([^}]*)\}/.exec(text)?.[1];
  return { success: success[1] === "true", hostname,
    errorCodes: codes === undefined ? undefined : [...codes.matchAll(/string\(\d+\)\s*"([^"]*)"/g)].map(m => m[1]) };
}

// Plain HTTP checks of every fixture contract; no browser session is created.
export async function preflight(request = fetch) {
  const observations = [];
  const page = async (fixture, marker) => {
    const { response, text } = await get(request, fixture.url);
    if (!response.ok) throw new Error(`${fixture.type} fixture HTTP ${response.status}`);
    if (!text.includes(marker)) throw new Error(`${fixture.type} fixture sitekey or markup changed`);
    observations.push({ type: fixture.type, httpStatus: response.status });
  };
  const byType = Object.fromEntries(FIXTURES.map(f => [f.type, f]));
  await page(byType.turnstile, byType.turnstile.sitekey);
  await page(byType.recaptcha, byType.recaptcha.sitekey);
  await page(byType.hcaptcha, byType.hcaptcha.sitekey);
  await page(byType["recaptcha-v3"], 'data-action="demo_action"');
  await page(byType.geetest, "geetest-demo-form");
  await page(byType.text, "simple-captcha-field");

  const turnstile = byType.turnstile, url = new URL(turnstile.verifier, turnstile.url);
  const response = await post(request, url, JSON.stringify({ widget: "managed", token: "invalid-preflight-token" }),
    { "content-type": "application/json", "x-zerocaptcha-client": "web" });
  const verdict = await response.json();
  if (response.status !== 200 || verdict.success !== false || verdict.testSecret !== false || verdict.widget !== "managed")
    throw new Error("Turnstile verifier did not reject an invalid token using a real secret");

  // hCaptcha's published test token passes only under the dummy secret.
  const hcaptcha = await post(request, byType.hcaptcha.url, new URLSearchParams({
    demo_text: "", "h-captcha-response": "10000000-aaaa-bbbb-cccc-000000000001" }).toString(),
  { "content-type": "application/x-www-form-urlencoded" });
  const siteverify = hcaptcha.ok ? parseSiteverifyDump(await hcaptcha.text()) : null;
  if (siteverify?.success !== false || !siteverify.errorCodes?.includes("not-using-dummy-secret"))
    throw new Error("hCaptcha demo did not reject the test token using a real secret");

  const v3 = byType["recaptcha-v3"];
  const v3Response = await post(request, new URL(v3.verifier, v3.url), JSON.stringify({ siteKey: v3.sitekey, answer: "invalid-preflight-token" }));
  if (v3Response.status !== 200 || (await v3Response.json()).success !== false)
    throw new Error("reCAPTCHA v3 verifier did not reject an invalid token");

  const geetest = byType.geetest;
  const init = await get(request, `${new URL(geetest.init, geetest.url)}?t=${Date.now()}`);
  const params = init.response.ok ? JSON.parse(init.text) : null;
  if (params?.success !== 1 || params.gt !== geetest.gt) throw new Error("GeeTest demo is offline or its gt changed");
  const gtResponse = await post(request, new URL(geetest.verifier, geetest.url), JSON.stringify({
    geetest_challenge: params.challenge, geetest_validate: "0".repeat(32), geetest_seccode: `${"0".repeat(32)}|jordan` }));
  if (gtResponse.status !== 200 || (await gtResponse.json()).success !== false)
    throw new Error("GeeTest verifier did not reject an invalid answer");

  // Walmart serves either the protected page or a redirect to its PerimeterX block page.
  const px = byType.perimeterx;
  const walmart = await request(px.url, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
  const location = walmart.headers.get("location") ?? "";
  const blocked = walmart.status >= 300 && walmart.status < 400 && new URL(location, px.url).href.startsWith("https://www.walmart.com/blocked");
  if (!blocked && !(walmart.status === 200 && (await walmart.text()).includes(px.appId)))
    throw new Error(`perimeterx fixture HTTP ${walmart.status} without the PerimeterX app ${px.appId}`);
  observations.push({ type: "perimeterx", httpStatus: walmart.status, blocked });

  return { checked_at: new Date().toISOString(), observations,
    turnstile_invalid_token: { httpStatus: response.status, success: verdict.success, testSecret: verdict.testSecret },
    hcaptcha_test_token: { success: siteverify.success, errorCodes: siteverify.errorCodes },
    geetest_online: true };
}
