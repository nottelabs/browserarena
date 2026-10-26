import { expect, test } from "@playwright/test";

// Keep the provider count and history stable as new daily runs are published.
const runDate = "2026-10-26";

for (const route of ["/", "/proxies", "/throughput"]) {
  test(`${route} keeps setup and ranking controls separate across screen sizes`, async ({ page }) => {
    await page.goto(`${route}?date=${runDate}`);
    const header = page.locator('[data-section-header="benchmark"]');
    await expect(header).toBeVisible();

    for (const width of [320, 768, 1228, 1280, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      // Recharts resizes after the viewport, so wait for layout to settle.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

      const menu = page.getByRole("button", { name: "Benchmark & setup" });
      if (width < 1280) {
        await expect(menu).toBeVisible();
        const menuBox = (await menu.boundingBox())!;
        const headerBox = (await header.boundingBox())!;
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(headerBox.y);
      } else {
        await expect(menu).toBeHidden();
      }

      const controlsBox = (await header.locator("[data-section-controls]").boundingBox())!;
      const headerBox = (await header.boundingBox())!;
      expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
      const brandBox = (await page.locator('[data-slot="navbar-brand"]').boundingBox())!;
      const actionsBox = (await page.locator('[data-slot="navbar-actions"]').boundingBox())!;
      expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(actionsBox.x);
    }
  });
}

test("history tooltip paints above overlapping legend text", async ({ page }) => {
  await page.goto(`/?date=${runDate}`);
  const panel = page.locator('[data-benchmark-panel="history"]');
  const grid = panel.locator(".recharts-cartesian-grid");
  await expect(grid).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 6, box.y + box.height / 2);
  await expect(panel.locator(".recharts-tooltip-wrapper")).toBeVisible();

  const tooltipCoversLegend = await panel.evaluate((element) => {
    const tooltip = element.querySelector<HTMLElement>(".recharts-tooltip-wrapper")!;
    const legend = element.querySelector(".recharts-legend-wrapper")!;
    const tooltipBox = tooltip.getBoundingClientRect();
    const textNodes = document.createTreeWalker(legend, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = textNodes.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const textBox = range.getBoundingClientRect();
      const left = Math.max(tooltipBox.left, textBox.left);
      const right = Math.min(tooltipBox.right, textBox.right);
      const top = Math.max(tooltipBox.top, textBox.top);
      const bottom = Math.min(tooltipBox.bottom, textBox.bottom);
      if (right <= left || bottom <= top) continue;
      // Tooltips ignore pointer events normally. Enable hit testing briefly
      // so the browser can tell us which element actually paints on top.
      const pointerEvents = tooltip.style.pointerEvents;
      tooltip.style.pointerEvents = "auto";
      const topElement = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      tooltip.style.pointerEvents = pointerEvents;
      return tooltip.contains(topElement);
    }
    return false;
  });
  expect(tooltipCoversLegend, "tooltip should cover legend text where they overlap").toBe(true);
});

test("Sessions has one panel border", async ({ page }) => {
  await page.goto(`/?date=${runDate}`);
  const distribution = page.getByRole("region", { name: "Session time distribution" });
  await expect(distribution).toBeVisible();
  const borderedPanels = await distribution.evaluate((element) => {
    let count = 0;
    for (let node: Element | null = element; node && node.tagName !== "MAIN"; node = node.parentElement) {
      if (parseFloat(getComputedStyle(node).borderTopWidth) > 0) count++;
    }
    return count;
  });
  expect(borderedPanels).toBe(1);
});
