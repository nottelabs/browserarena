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

const newerId = `${campaignId}-newer`;
const newerFile = path.join(directory, `${newerId}.json`);
const newer = { ...fixture, id: newerId, started_at: "2099-01-01T00:00:00Z", finished_at: "2099-01-01T00:02:00Z" };

// A protocol v4 campaign with the seven types; older campaigns keep their three columns.
const v4Id = `${campaignId}-v4`;
const v4File = path.join(directory, `${v4Id}.json`);
const v4Types = ["turnstile", "recaptcha", "hcaptcha", "recaptcha-v3", "geetest", "text", "perimeterx"];
const v4 = { ...fixture, protocol_version: 4, id: v4Id, providers: ["kernel"], complete: false, halted: false,
  attempts: [
    { id: "r01-kernel-text", provider: "kernel", type: "text", round: 1, stage: "verify", status: "page_passed",
      accepted_ms: null, token_ms: 9000, passed_ms: 9500, cleanup_failed: false },
    { id: "r01-kernel-perimeterx", provider: "kernel", type: "perimeterx", round: 1, stage: "solve", status: "page_passed",
      accepted_ms: null, token_ms: null, passed_ms: 3000, cleanup_failed: false },
  ] };

test.beforeAll(async () => {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(file, JSON.stringify(fixture), { flag: "wx" });
  await fs.writeFile(newerFile, JSON.stringify(newer), { flag: "wx" });
  await fs.writeFile(v4File, JSON.stringify(v4), { flag: "wx" });
});
test.afterAll(async () => { await fs.unlink(file); await fs.unlink(newerFile); await fs.unlink(v4File); });

test("CAPTCHA v4 campaigns show every type with its success signal", async ({ page }) => {
  await page.goto(`/captcha?campaign=${v4Id}`);
  await expect(page.locator("thead th")).toHaveCount(1 + v4Types.length);
  for (const label of ["reCAPTCHA v3", "GeeTest v3", "Text CAPTCHA", "PerimeterX"])
    await expect(page.locator("thead th", { hasText: label })).toBeVisible();
  await expect(page.getByText("Page check", { exact: true })).toBeVisible();
  await expect(page.getByText("Page reached", { exact: true })).toBeVisible();
  await expect(page.locator('strong[aria-label="Kernel PerimeterX: 1 of 1 reached"]')).toBeVisible();
  await expect(page.locator('strong[aria-label="Kernel Text CAPTCHA: 1 of 1 passed"]')).toBeVisible();
  await expect(page.locator('li[aria-label="Round 1: Passed"]')).toHaveCount(2);
});

test("CAPTCHA page labels only the newest campaign as the latest run", async ({ page }) => {
  await page.goto("/captcha");
  await expect(page.getByText("Latest run", { exact: false })).toContainText("1 January 2099");
  await page.goto(`/captcha?campaign=${newerId}`);
  await expect(page.getByText("Latest run", { exact: false })).toContainText("1 January 2099");
  await page.goto(`/captcha?campaign=${campaignId}`);
  await expect(page.getByText("Run on", { exact: false })).toContainText("28 October 2026");
  await expect(page.getByText("Latest run", { exact: false })).toHaveCount(0);
});

test("CAPTCHA run picker and run history select campaigns by ID", async ({ page }) => {
  await page.goto("/captcha");
  const picker = page.getByRole("combobox", { name: "Run date" });
  await expect(picker).toHaveValue(newerId);
  // Options select campaigns by ID; navigation goes through the shared picker used by every benchmark.
  const options = await picker.locator("option").evaluateAll(items => items.map(item => [(item as HTMLOptionElement).value, item.textContent]));
  expect(options).toContainEqual([newerId, "Jan 1, 2099 (partial)"]);
  expect(options).toContainEqual([campaignId, "Oct 28, 2026 (partial)"]);
  const runs = page.getByRole("region", { name: "Published CAPTCHA campaigns" });
  // Hrefs, not client navigation: on a cold local server the shell's prefetches delay router pushes.
  await expect(runs.getByRole("link", { name: "Jan 1, 2099 (partial)" })).toHaveAttribute("href", "/captcha");
  const older = runs.getByRole("link", { name: "Oct 28, 2026 (partial)" });
  await expect(older).toHaveAttribute("href", `/captcha?campaign=${campaignId}`);
  await page.goto((await older.getAttribute("href"))!);
  await expect(page.getByText("Run on", { exact: false })).toContainText("28 October 2026");
  await expect(picker).toHaveValue(campaignId);
  await expect(runs.locator('tr[aria-current="page"]')).toContainText("Oct 28, 2026 (partial)");
});

test("CAPTCHA campaigns preserve partial coverage, delivery labels and mobile access", async ({ page, request }) => {
  await page.goto(`/captcha?campaign=${campaignId}`);
  await expect(page.getByRole("heading", { name: "CAPTCHA Handling", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Campaign halted");
  const table = page.getByRole("region", { name: "Provider CAPTCHA results" });
  await expect(table.locator("thead th")).toHaveText(["#", "Provider", "Overall", "Cloudflare Turnstile", "reCAPTCHA v2", "hCaptcha"]);
  // Ranked by overall success with errors and timeouts in the denominator: 2/2 before 1/2.
  await expect(table.locator("tbody tr").first().locator("td").first()).toHaveText("1");
  await expect(table.locator("tbody tr").first()).toHaveAttribute("data-leader", "");
  // Ties on rate and median time fall back to the provider name.
  // Benchmarked providers missing from the run, then providers without native
  // solving, follow unranked, each group by name.
  await expect(table.locator("tbody th")).toHaveText(["Browser Use", "KERNEL", "Notte", "Browserbase", "Steel",
    "Anchor Browser", "Browserless", "Hyperbrowser", "Tilion",
    "AWS AgentCore", "Cloudflare", "Lightpanda", "TinyFish"]);
  await expect(table.locator("tbody tr td:first-child")).toHaveText(["1", "2", "3", "4", "5", "–", "–", "–", "–", "–", "–", "–", "–"]);
  // The label depends on the published history these fixtures sit beside: once a
  // real campaign includes Hyperbrowser, this synthetic run says "Not in this run".
  const history = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith(".json"))
    .map(async name => JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) as { providers: string[] }));
  const hyperbrowserNote = history.some(item => item.providers.includes("hyperbrowser")) ? "Not in this run" : "No results yet";
  await expect(page.getByRole("row", { name: new RegExp(`Hyperbrowser.*${hyperbrowserNote}`) })).toBeVisible();
  await expect(table.locator("tbody tr").first().locator("img")).toHaveCount(1);
  await page.getByLabel("About hCaptcha").focus();
  await expect(page.getByRole("tooltip")).toContainText("Token delivery only");
  await expect(page.getByText("1 not run", { exact: true })).toHaveCount(5);
  await expect(page.getByText("1 cleanup failure", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Cloudflare Browser Run has no CAPTCHA solving/ })).toBeVisible();
  await expect(page.locator('strong[aria-label="KERNEL hCaptcha: 1 of 1 delivered"]')).toHaveText("1 / 1");
  await expect(page.locator('li[aria-label="Round 1: Token delivered"]').first()).toBeVisible();
  const dot = page.locator('li[aria-label="Round 1: Token delivered"]').first();
  await dot.focus();
  await expect.poll(() => dot.evaluate(element => { const tip = getComputedStyle(element, "::after"); return `${tip.visibility} ${tip.content}`; })).toBe('visible "Round 1: Token delivered"');
  // Tapping a dot shows its label instead of opening the provider page.
  await dot.click();
  await expect(page).toHaveURL(new RegExp(`/captcha\\?campaign=${campaignId}$`));
  await expect(page.getByRole("link", { name: "Export results" })).toHaveAttribute("href", `/api/captcha?campaign=${campaignId}`);
  await expect(page.getByRole("link", { name: "Methodology" })).toHaveAttribute("href", /docs\/captcha\.md$/);
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
