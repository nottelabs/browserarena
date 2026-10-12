/**
 * Server-side analytics helpers: caller classification, and the guarantee that
 * a missing PostHog token never affects request handling.
 *
 *   cd web && npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { callerKind, captureApiRequest } from "./posthog-server";
import { withNotteUtm } from "./utm";

test("callerKind labels the callers the public endpoints actually see", () => {
  const cases: [string, string][] = [
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", "ai-agent"],
    ["Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ai-agent"],
    ["Better Stack Better Uptime Bot Mozilla/5.0", "uptime-monitor"],
    ["Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)", "uptime-monitor"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "search-crawler"],
    ["curl/8.7.1", "script"],
    ["python-requests/2.32.3", "script"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "browser"],
    ["", "unknown"],
    ["some-internal-tool/1.0", "other"],
  ];
  for (const [ua, kind] of cases) assert.equal(callerKind(ua), kind, ua || "(empty)");
});

test("without a PostHog token, capturing is a silent no-op", () => {
  const saved = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  try {
    // Outside a request scope `after()` would throw, so returning cleanly
    // proves the helper bails out before scheduling anything.
    assert.doesNotThrow(() => captureApiRequest(new Request("https://www.browserarena.ai/api/health"), "/api/health"));
  } finally {
    if (saved !== undefined) process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = saved;
  }
});

test("withNotteUtm tags notte.cc links and leaves other hosts alone", () => {
  const tagged = new URL(withNotteUtm("https://notte.cc", "footer"));
  assert.equal(tagged.searchParams.get("utm_source"), "browserarena");
  assert.equal(tagged.searchParams.get("utm_medium"), "referral");
  assert.equal(tagged.searchParams.get("utm_campaign"), "footer");
  assert.equal(new URL(withNotteUtm("https://www.notte.cc/pricing?x=1", "leaderboard")).searchParams.get("x"), "1");
  assert.equal(withNotteUtm("https://www.browserbase.com", "leaderboard"), "https://www.browserbase.com");
  assert.equal(withNotteUtm("https://notte.cc.evil.example", "footer"), "https://notte.cc.evil.example");
  assert.equal(withNotteUtm("not a url", "footer"), "not a url");
});
