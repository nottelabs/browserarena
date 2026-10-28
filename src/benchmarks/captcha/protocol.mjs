export const PROVIDERS = ["kernel", "browserbase", "browser-use", "steel", "notte"];
export const FIXTURES = [
  { type: "turnstile", url: "https://zerocaptcha.io/captcha-test/cloudflare-turnstile-managed",
    form: "form[data-demo-form]", token: 'input[name="cf-turnstile-response"]',
    sitekey: "0x4AAAAAAFMVDQUY9ZAPO0ni", verifier: "/api/v1/demo/verify" },
  { type: "recaptcha", url: "https://www.google.com/recaptcha/api2/demo",
    form: "#recaptcha-demo-form", token: 'textarea[name="g-recaptcha-response"]',
    sitekey: "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-" },
  { type: "hcaptcha", url: "https://nopecha.com/captcha/hcaptcha#enterprise",
    form: ".cell", token: 'textarea[name="h-captcha-response"]', result: "#token_3",
    script: "/js/demo/hcaptcha.js?v=2", sitekey: "58366d97-3e8c-4b57-a679-4a41c8423be3" },
];

export function configuration(input = {}) {
  const config = { rounds: 5, concurrency: 3, solveTimeoutMs: 180_000,
    cooldownMs: 5_000, providers: PROVIDERS, ...input };
  if (!Number.isSafeInteger(config.rounds) || config.rounds < 1 || config.rounds > 20)
    throw new Error("rounds must be an integer from 1 through 20");
  if (!Array.isArray(config.providers) || !config.providers.length ||
      new Set(config.providers).size !== config.providers.length ||
      config.providers.some(name => !PROVIDERS.includes(name)))
    throw new Error("providers must be a unique subset of the five supported providers");
  if (!Number.isSafeInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 3)
    throw new Error("concurrency must be an integer from 1 through 3");
  if (config.solveTimeoutMs !== 180_000 || config.cooldownMs !== 5_000)
    throw new Error("Protocol v2 fixes the solve window at 180s and cooldown at 5s");
  const unknown = Object.keys(input).filter(k => !["rounds", "concurrency", "providers", "solveTimeoutMs", "cooldownMs"].includes(k));
  if (unknown.length) throw new Error(`Unknown configuration fields: ${unknown.join(", ")}`);
  return { version: 2, rounds: config.rounds, providers: [...config.providers],
    concurrency: config.concurrency, solveTimeoutMs: 180_000, cooldownMs: 5_000,
    navigationTimeoutMs: 30_000, viewport: { width: 1920, height: 1080 },
    retries: 0, fixtures: FIXTURES.map(f => ({ ...f })) };
}

export function schedule(config) {
  return Array.from({ length: config.rounds }, (_, round) => {
    const providers = config.providers.map((_, index) => config.providers[(index + round) % config.providers.length]);
    return providers.flatMap(provider => FIXTURES.map((_, index) => {
      const fixture = FIXTURES[(index + round) % FIXTURES.length];
      return { id: `r${String(round + 1).padStart(2, "0")}-${provider}-${fixture.type}`,
        round: round + 1, provider, fixture };
    }));
  });
}

export function acceptedTurnstile(verdict) {
  return verdict?.httpStatus === 200 && verdict.success === true &&
    verdict.testSecret === false && verdict.hostname === "zerocaptcha.io" && verdict.widget === "managed";
}

export function acceptedOfficial(state, receipt, fixture) {
  return fixture.type === "recaptcha" && state?.accepted === true && state.formPresent === false &&
    receipt?.httpStatus === 200 && receipt.method === "POST" && receipt.url === fixture.url;
}

export function deliveredNopecha(state) {
  return state?.tokenPresent === true && state.callbackSuccess === true &&
    state.widgetResponseMatches === true && state.sitekeys?.includes(FIXTURES[2].sitekey) === true;
}

export function interval(successes, n) {
  if (!n) return null;
  const z = 1.959963984540054, p = successes / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function summarize(config, rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`Duplicate attempt: ${row.id}`);
    seen.add(row.id);
  }
  return config.providers.flatMap(provider => FIXTURES.map(fixture => {
    const attempts = rows.filter(r => r.provider === provider && r.type === fixture.type);
    const verified = attempts.filter(r => r.status === "verified");
    const delivered = attempts.filter(r => r.status === "token_delivered");
    const times = verified.map(r => r.accepted_ms).sort((a, b) => a - b);
    const deliveredTimes = delivered.map(r => r.token_ms).sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    const deliveredMiddle = Math.floor(deliveredTimes.length / 2);
    return { provider, type: fixture.type, planned: config.rounds, attempted: attempts.length,
      verified: verified.length, token_delivered: delivered.length, timeout: attempts.filter(r => r.status === "timeout").length,
      rejected: attempts.filter(r => r.status === "rejected").length,
      error: attempts.filter(r => r.status === "error").length,
      interrupted: attempts.filter(r => r.status === "interrupted").length,
      cleanup_errors: attempts.filter(r => r.session_id && !r.cleanup?.released || r.cleanup?.disconnect_error).length,
      not_run: config.rounds - attempts.length,
      acceptance_interval_95: interval(verified.length, attempts.length),
      delivery_interval_95: interval(delivered.length, attempts.length),
      delivered_median_ms: deliveredTimes.length ? (deliveredTimes.length % 2 ? deliveredTimes[deliveredMiddle]
        : (deliveredTimes[deliveredMiddle - 1] + deliveredTimes[deliveredMiddle]) / 2) : null,
      accepted_median_ms: times.length ? (times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2) : null,
      rounds: attempts.map(r => ({ round: r.round, status: r.status, accepted_ms: r.accepted_ms ?? null, token_ms: r.token_ms ?? null })),
    };
  }));
}

export async function preflight(request = fetch) {
  const observations = [];
  for (const fixture of FIXTURES) {
    const response = await request(fixture.url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error(`${fixture.type} fixture HTTP ${response.status}`);
    const html = await response.text();
    if (fixture.script) {
      if (!html.includes(fixture.script)) throw new Error(`${fixture.type} fixture script changed`);
      const script = await request(new URL(fixture.script, fixture.url), { signal: AbortSignal.timeout(20_000), redirect: "error" });
      if (!script.ok || !(await script.text()).includes(fixture.sitekey)) throw new Error(`${fixture.type} fixture sitekey changed`);
    } else if (!html.includes(fixture.sitekey)) throw new Error(`${fixture.type} fixture sitekey changed`);
    observations.push({ type: fixture.type, httpStatus: response.status, sitekey: fixture.sitekey });
  }
  const url = new URL(FIXTURES[0].verifier, FIXTURES[0].url);
  const response = await request(url, { method: "POST", headers: {
    "content-type": "application/json", "x-zerocaptcha-client": "web", origin: url.origin,
  }, body: JSON.stringify({ widget: "managed", token: "invalid-preflight-token" }),
  signal: AbortSignal.timeout(20_000), redirect: "error" });
  const verdict = await response.json();
  if (response.status !== 200 || verdict.success !== false || verdict.testSecret !== false || verdict.widget !== "managed")
    throw new Error("Turnstile verifier did not reject an invalid token using a real secret");
  return { checked_at: new Date().toISOString(), observations,
    turnstile_invalid_token: { httpStatus: response.status, success: verdict.success, testSecret: verdict.testSecret } };
}
