import { expect, test } from "@playwright/test";

// Keep the selected day's leaderboard stable as new daily runs are published.
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
      if (textBox.width === 0 || textBox.height === 0) continue;
      // History rolls forward independently of the selected leaderboard date.
      // A sparse day can have a tooltip too short to overlap the legend at all.
      // Place it over actual legend text without changing either stacking order.
      const originalStyle = tooltip.getAttribute("style");
      try {
        tooltip.style.translate = `${textBox.left - tooltipBox.left}px ${textBox.top - tooltipBox.top}px`;
        // Enable hit testing so the browser reports which element paints on top.
        tooltip.style.pointerEvents = "auto";
        const topElement = document.elementFromPoint(
          textBox.left + Math.min(textBox.width, tooltipBox.width) / 2,
          textBox.top + Math.min(textBox.height, tooltipBox.height) / 2,
        );
        return tooltip.contains(topElement);
      } finally {
        if (originalStyle === null) tooltip.removeAttribute("style");
        else tooltip.setAttribute("style", originalStyle);
      }
    }
    return false;
  });
  expect(tooltipCoversLegend, "tooltip should cover legend text where they overlap").toBe(true);
});

test("select chevrons keep padding from the right border", async ({ page }) => {
  await page.goto(`/?date=${runDate}`);
  for (const name of ["Run date", "Breakdown provider"]) {
    const select = page.getByRole("combobox", { name });
    await select.scrollIntoViewIfNeeded();
    const png = (await select.screenshot({ scale: "css" })).toString("base64");
    // Darkest pixel in a vertical strip, measured in CSS pixels from the right edge.
    const darkest = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = `data:image/png;base64,${src}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const strip = (from: number, to: number) => {
        let min = 255;
        for (let x = image.width - to; x < image.width - from; x++) {
          const { data } = context.getImageData(x, 3, 1, image.height - 6);
          for (let i = 0; i < data.length; i += 4) min = Math.min(min, (data[i] + data[i + 1] + data[i + 2]) / 3);
        }
        return min;
      };
      return { gap: strip(3, 9), chevron: strip(10, 24) };
    }, png);
    expect(darkest.chevron, `${name} chevron should be drawn`).toBeLessThan(128);
    expect(darkest.gap, `${name} chevron should not touch the border`).toBeGreaterThan(200);
  }
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
