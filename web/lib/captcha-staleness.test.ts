import test from "node:test";
import assert from "node:assert/strict";

import { loadCaptchaCampaigns } from "./captcha-data";
import { captchaStaleness, CAPTCHA_STALENESS_HOURS } from "./captcha-staleness";

const day = (date: string) => ({ finished_at: `${date}T09:34:34.192Z` });

test("a campaign that finished within the window is not stale", () => {
  const result = captchaStaleness([day("2026-11-11"), day("2026-11-12")], new Date("2026-11-13T12:00:00Z"));
  assert.equal(result?.latest, "2026-11-12T09:34:34.192Z");
  assert.equal(result?.stale, false);
});

test("a missed day turns stale at the next scheduled check", () => {
  const result = captchaStaleness([day("2026-11-12")], new Date("2026-11-14T12:00:00Z"));
  assert.equal(result?.stale, true);
  assert.ok(result!.ageHours > CAPTCHA_STALENESS_HOURS);
});

test("campaigns after the as-of time are ignored, and no history means no verdict", () => {
  const result = captchaStaleness([day("2026-11-12"), day("2026-11-20")], new Date("2026-11-14T12:00:00Z"));
  assert.equal(result?.latest, "2026-11-12T09:34:34.192Z");
  assert.equal(captchaStaleness([], new Date("2026-11-14T12:00:00Z")), null);
  assert.equal(captchaStaleness([day("2026-11-20")], new Date("2026-11-14T12:00:00Z")), null);
});

// Backtest: the 2026-11-13 halt left 2026-11-12 as the last published campaign.
test("the committed results flag the 2026-11-13 halt the next day", async () => {
  const campaigns = await loadCaptchaCampaigns();
  assert.equal(captchaStaleness(campaigns, new Date("2026-11-13T12:00:00Z"))?.stale, false);
  assert.equal(captchaStaleness(campaigns, new Date("2026-11-14T12:00:00Z"))?.stale, true);
});
