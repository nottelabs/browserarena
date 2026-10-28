import { expect, test } from "@playwright/test";

test("throughput defaults to a complete day and labels selectable partial days", async ({ page, request }, testInfo) => {
  const response = await request.get("/api/browser-throughput");
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  const publication = data.metadata.publication;
  await page.goto("/throughput");
  const picker = page.getByRole("combobox", { name: "Run date" });
  await expect(picker).toHaveValue(publication.latestCompleteDate);
  await expect(page.locator("tbody tr")).toHaveCount(data.providers.length);

  const partial = publication.coverage.findLast((day: { complete: boolean }) => !day.complete);
  if (partial) {
    await expect(picker.locator(`option[value="${partial.date}"]`)).toContainText("(partial)");
    await picker.selectOption(partial.date);
    await expect(page).toHaveURL(new RegExp(`date=${partial.date}`));
    await expect(page.getByRole("status")).toHaveText(
      `Partial results: ${partial.reported} of ${partial.expected} providers have reported for this date.`,
    );
    await expect(page.locator("tbody tr")).toHaveCount(partial.reported);
  }

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 950 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = (await picker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`throughput-${width}.png`) });
  }
});
