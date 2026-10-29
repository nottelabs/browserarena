import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("../results/captcha");
const campaignId = `synthetic-layout-${process.pid}`;
const file = path.join(directory, `${campaignId}.json`);
const providers = ["kernel", "browserbase", "browser-use", "steel", "notte"];
const fixture = {
  benchmark: "captcha", schema_version: 1, protocol_version: 3, id: campaignId,
  started_at: "2026-10-28T00:00:00Z", finished_at: "2026-10-28T00:02:00Z", revision: "a".repeat(40),
  providers, rounds: 1, concurrency: 3, complete: false, halted: true, interrupted: false,
  attempts: providers.flatMap((provider, index) => [
    { id: `r01-${provider}-turnstile`, provider, type: "turnstile", round: 1, stage: "solve",
      status: index % 2 ? "timeout" : "verified", accepted_ms: index % 2 ? null : 1200, token_ms: null, cleanup_failed: false },
    { id: `r01-${provider}-hcaptcha`, provider, type: "hcaptcha", round: 1, stage: "solve",
      status: "token_delivered", accepted_ms: null, token_ms: 1500, cleanup_failed: provider === "notte" },
  ]),
};

test.beforeAll(async () => {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(file, JSON.stringify(fixture), { flag: "wx" });
});
test.afterAll(async () => { await fs.unlink(file); });

test("CAPTCHA campaigns preserve partial coverage, delivery labels and mobile access", async ({ page, request }) => {
  await page.goto(`/captcha?campaign=${campaignId}`);
  await expect(page.getByRole("heading", { name: "CAPTCHA Handling", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Campaign halted");
  await expect(page.getByText("Token delivery only", { exact: true })).toBeVisible();
  await expect(page.getByText("1 not run", { exact: true })).toHaveCount(5);
  await expect(page.getByText("1 cleanup failure", { exact: true })).toBeVisible();
  await page.locator('summary[aria-label="Kernel hCaptcha: 1 of 1 delivered"]').click();
  await expect(page.getByText("Round 1: Token delivered", { exact: true }).first()).toBeVisible();
  const response = await request.get(`/api/captcha?campaign=${campaignId}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).attempts).toHaveLength(10);
  const output = path.resolve("../.captcha-runs");
  await fs.mkdir(output, { recursive: true });
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width < 1280) {
      await page.getByRole("button", { name: "Benchmark & setup" }).click();
      await expect(page.getByRole("link", { name: "CAPTCHA Handling", exact: true })).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    }
    await page.screenshot({ path: path.join(output, `captcha-${width}.png`), fullPage: true });
  }
});

test("CAPTCHA API and page refuse invalid or missing campaign selections", async ({ page, request }) => {
  expect((await request.get("/api/captcha?campaign=missing-campaign")).status()).toBe(404);
  expect((await request.get("/api/captcha?campaign=..%2Foutside")).status()).toBe(400);
  await page.goto("/captcha?campaign=missing-campaign");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
