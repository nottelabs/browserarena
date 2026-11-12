import { expect, test } from "@playwright/test";

// Uses the published campaigns: provider pages are cached, and /captcha prefetches
// them, so fixtures written during the run would not reliably reach them.
test("CAPTCHA provider links open the provider's CAPTCHA section", async ({ page }) => {
  // Wide enough for the in-page sidebar to show without its drawer.
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/captcha");
  const link = page.getByRole("region", { name: "Provider CAPTCHA results" }).locator("tbody tr").first().getByRole("link");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/provider\/[a-z-]+#captcha$/);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  const section = page.locator("#captcha");
  await expect(section.getByRole("region", { name: /CAPTCHA results by type$/ })).toBeVisible();
  // Sections stream in after navigation; the page still scrolls to the hash.
  await expect(section).toBeInViewport();
  // The last section never reaches the top, so the sidebar selects it at the page bottom.
  const current = page.getByRole("navigation", { name: "Jump to a section" }).getByRole("link", { name: "CAPTCHA Handling" });
  await expect(current).toHaveAttribute("aria-current", "location");

  // A query the build did not prerender streams its sections in after the
  // browser's own jump to the hash, like the country links' #proxy.
  await page.goto(href!.replace("#", "?country=FR#"));
  await expect(section.getByRole("region", { name: /CAPTCHA results by type$/ })).toBeVisible();
  await expect(section).toBeInViewport();
  await expect(current).toHaveAttribute("aria-current", "location");
});

test("Provider pages without native CAPTCHA solving say why", async ({ page }) => {
  await page.goto("/provider/tinyfish");
  await expect(page.locator("#captcha")).toContainText("TinyFish has no CAPTCHA solving");
});
