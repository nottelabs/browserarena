import type { Page } from "playwright-core";

const SCROLL_PX = 600;
const SCROLL_PAUSE_MS = 120;

async function scrollDown(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate((dy) => window.scrollBy(0, dy), SCROLL_PX);
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }
}

export interface ExtractedArticle {
  title: string;
  summary: string;
  infoboxFacts: string[];
  sectionHeadings: string[];
  internalLinks: string[];
  wordCount: number;
  imageCount: number;
  outboundLinkCount: number;
}

export interface CrawledPage {
  title: string;
  summary: string;
  sectionHeadings: string[];
  wordCount: number;
  imageCount: number;
  outboundLinkCount: number;
  /** Internal links for second-level crawl */
  nextLinks: string[];
}

async function extractFull(page: Page): Promise<ExtractedArticle> {
  return page.evaluate(() => {
    const title =
      document.querySelector("#firstHeading")?.textContent?.trim() ?? "";

    const paragraphs = document.querySelectorAll(
      "#mw-content-text .mw-parser-output > p"
    );
    let summary = "";
    for (const p of paragraphs) {
      const text = p.textContent?.trim() ?? "";
      if (text.length > 80) {
        summary = text.slice(0, 500);
        break;
      }
    }

    // Infobox key-value pairs
    const infoboxFacts: string[] = [];
    const infoboxRows = document.querySelectorAll(".infobox tr");
    for (const row of infoboxRows) {
      const th = row.querySelector("th")?.textContent?.trim();
      const td = row.querySelector("td")?.textContent?.trim();
      if (th && td && infoboxFacts.length < 5) {
        infoboxFacts.push(`${th}: ${td.slice(0, 100)}`);
      }
    }

    // Section headings
    const sectionHeadings = Array.from(
      document.querySelectorAll("#mw-content-text h2 .mw-headline, #mw-content-text h2")
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => t.length > 0 && t !== "edit")
      .slice(0, 10);

    // Internal links (for crawling)
    const seen = new Set<string>();
    const internalLinks: string[] = [];
    const anchors = document.querySelectorAll(
      '#mw-content-text a[href^="/wiki/"]:not([href*=":"]):not([href*="#"])'
    );
    for (const a of anchors) {
      const href = a.getAttribute("href")!;
      if (!seen.has(href) && internalLinks.length < 5) {
        seen.add(href);
        internalLinks.push(href);
      }
    }

    // Word count from article body
    const bodyText = document.querySelector("#mw-content-text")?.textContent ?? "";
    const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length;

    // Image count
    const imageCount = document.querySelectorAll("#mw-content-text img").length;

    // Total outbound link count
    const outboundLinkCount = document.querySelectorAll(
      '#mw-content-text a[href^="/wiki/"]:not([href*=":"]):not([href*="#"])'
    ).length;

    return { title, summary, infoboxFacts, sectionHeadings, internalLinks, wordCount, imageCount, outboundLinkCount };
  });
}

async function extractCrawled(page: Page, visitedPaths: Set<string>): Promise<CrawledPage> {
  return page.evaluate((visited: string[]) => {
    const title =
      document.querySelector("#firstHeading")?.textContent?.trim() ?? "";

    const paragraphs = document.querySelectorAll(
      "#mw-content-text .mw-parser-output > p"
    );
    let summary = "";
    for (const p of paragraphs) {
      const text = p.textContent?.trim() ?? "";
      if (text.length > 80) {
        summary = text.slice(0, 300);
        break;
      }
    }

    const sectionHeadings = Array.from(
      document.querySelectorAll("#mw-content-text h2 .mw-headline, #mw-content-text h2")
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => t.length > 0 && t !== "edit")
      .slice(0, 10);

    const bodyText = document.querySelector("#mw-content-text")?.textContent ?? "";
    const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length;
    const imageCount = document.querySelectorAll("#mw-content-text img").length;
    const outboundLinkCount = document.querySelectorAll(
      '#mw-content-text a[href^="/wiki/"]:not([href*=":"]):not([href*="#"])'
    ).length;

    // Find unvisited internal links for second-level crawl
    const visitedSet = new Set(visited);
    const nextLinks: string[] = [];
    const anchors = document.querySelectorAll(
      '#mw-content-text a[href^="/wiki/"]:not([href*=":"]):not([href*="#"])'
    );
    for (const a of anchors) {
      const href = a.getAttribute("href")!;
      if (!visitedSet.has(href) && nextLinks.length < 2) {
        nextLinks.push(href);
      }
    }

    return { title, summary, sectionHeadings, wordCount, imageCount, outboundLinkCount, nextLinks };
  }, [...visitedPaths]);
}

/**
 * Phase 1: Navigate to a Wikipedia article, scroll to trigger lazy content, extract structured data.
 */
export async function phaseExtract(
  page: Page,
  url: string
): Promise<ExtractedArticle> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await scrollDown(page, 6);
  await page.evaluate(() => window.scrollTo(0, 0));
  return extractFull(page);
}

/**
 * Phase 2: Four-level crawl.
 * Level 1: Follow 5 links from the seed article (5 scrolls each).
 * Level 2: Follow 2 links per level-1 page = up to 10 pages (4 scrolls each).
 * Level 3: Follow 2 links per level-2 page = up to 20 pages (3 scrolls each).
 * Level 4: Follow 1 link per level-3 page = up to 20 pages (2 scrolls each).
 * Total: up to 55 additional pages visited (56 including seed).
 */
export async function phaseCrawl(
  page: Page,
  links: string[]
): Promise<CrawledPage[]> {
  const results: CrawledPage[] = [];
  const visitedPaths = new Set<string>(links);

  async function crawlLevel(
    levelLinks: string[],
    scrolls: number,
    maxNextPerPage: number = 2,
  ): Promise<string[]> {
    const nextLevel: string[] = [];
    for (const link of levelLinks) {
      const fullUrl = `https://en.wikipedia.org${link}`;
      await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
      await scrollDown(page, scrolls);
      await page.evaluate(() => window.scrollTo(0, 0));

      const data = await extractCrawled(page, visitedPaths);
      results.push(data);

      let added = 0;
      for (const nl of data.nextLinks) {
        if (!visitedPaths.has(nl) && added < maxNextPerPage) {
          visitedPaths.add(nl);
          nextLevel.push(nl);
          added++;
        }
      }
    }
    return nextLevel;
  }

  // Level 1: 5 pages, 5 scrolls each
  const level2Links = await crawlLevel(links, 5);

  // Level 2: up to 10 pages, 4 scrolls each
  const level3Links = await crawlLevel(level2Links, 4);

  // Level 3: up to 20 pages, 3 scrolls each
  const level4Links = await crawlLevel(level3Links, 3);

  // Level 4: up to 20 pages, 2 scrolls each
  await crawlLevel(level4Links, 2, 1);

  return results;
}

/**
 * Phase 3: Navigate to httpbin form, fill it with data from Phases 1 & 2, submit, verify.
 */
export async function phaseForm(
  page: Page,
  article: ExtractedArticle,
  crawled: CrawledPage[]
): Promise<boolean> {
  await page.goto("https://httpbin.org/forms/post", {
    waitUntil: "domcontentloaded",
  });
  await scrollDown(page, 1);

  // Fill customer name with article title
  await page.fill('input[name="custname"]', article.title);

  // Fill telephone
  await page.fill('input[name="custtel"]', "555-0199");

  // Fill email from the article slug
  const slug = article.title.toLowerCase().replace(/\s+/g, ".");
  await page.fill('input[name="custemail"]', `${slug}@research.test`);

  // Select a pizza size based on section count
  const sizes = ["small", "medium", "large"];
  const sizeIdx = Math.min(
    Math.floor(article.sectionHeadings.length / 4),
    sizes.length - 1
  );
  await page.click(`input[name="size"][value="${sizes[sizeIdx]}"]`);

  // Check topping checkboxes based on crawled page count
  const toppings = ["cheese", "onion", "mushroom"];
  for (let i = 0; i < Math.min(crawled.length, toppings.length); i++) {
    await page.click(`input[name="topping"][value="${toppings[i]}"]`);
  }

  // Fill comments with the research summary (all 6+ crawled pages)
  const commentLines = [
    `Research on: ${article.title} (${article.wordCount} words, ${article.imageCount} images)`,
    `Facts: ${article.infoboxFacts.slice(0, 3).join("; ")}`,
    ...crawled.map((c) => `- ${c.title} (${c.wordCount}w): ${c.summary.slice(0, 80)}`),
  ];
  await page.fill(
    'textarea[name="comments"]',
    commentLines.join("\n").slice(0, 1000)
  );

  // Submit the form — httpbin POSTs and returns the data on a new page
  const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit")').first();
  await submitButton.click({ timeout: 10_000 });
  // Wait for the response page to load (URL changes to /post)
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

  // Verify: httpbin returns the submitted data on the response page
  const bodyText = await page.evaluate(() => document.body.innerText);
  return bodyText.includes(article.title);
}
