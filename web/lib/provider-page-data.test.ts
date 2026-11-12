import test from "node:test";
import assert from "node:assert/strict";
import { validateCampaign } from "../../src/benchmarks/captcha/publication";
import { captchaForProvider } from "./provider-page-data";

const attempt = (provider: string) => ({ id: `r01-${provider}-turnstile`, provider, type: "turnstile", round: 1, stage: "solve",
  status: "verified", accepted_ms: 1200, token_ms: null, cleanup_failed: false });
const campaign = (id: string, startedAt: string, providers: string[], attempts: unknown[]) => validateCampaign({
  benchmark: "captcha", schema_version: 1, protocol_version: 3, id, started_at: startedAt, finished_at: startedAt,
  revision: "a".repeat(40), providers, rounds: 1, concurrency: 1, complete: false, halted: true, interrupted: false, attempts });

test("provider CAPTCHA results skip a newer campaign that listed the provider but never ran it", () => {
  // Newest first, as loadCaptchaCampaigns returns them.
  const campaigns = [
    campaign("halted", "2026-11-02T00:00:00Z", ["kernel", "anchorbrowser"], [attempt("kernel")]),
    campaign("ran", "2026-11-01T00:00:00Z", ["anchorbrowser"], [attempt("anchorbrowser")]),
  ];
  const result = captchaForProvider("ANCHORBROWSER", campaigns);
  assert.equal(result.status, "measured");
  assert.deepEqual(result.campaign, { id: "ran", startedAt: "2026-11-01T00:00:00.000Z", rounds: 1, latest: false });
  assert.equal(result.row?.successes, 1);
  assert.equal(result.row?.attempted, 1);
  assert.equal(captchaForProvider("KERNEL", campaigns).campaign?.latest, true);
});

test("provider CAPTCHA results report providers never run, or without native solving", () => {
  const campaigns = [campaign("halted", "2026-11-02T00:00:00Z", ["kernel", "anchorbrowser"], [attempt("kernel")])];
  assert.equal(captchaForProvider("ANCHORBROWSER", campaigns).status, "absent");
  assert.equal(captchaForProvider("STEEL", []).status, "absent");
  const tinyfish = captchaForProvider("TINYFISH", campaigns);
  assert.equal(tinyfish.status, "unsupported");
  assert.match(tinyfish.note ?? "", /TinyFish has no CAPTCHA solving/);
});
