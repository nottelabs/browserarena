import type { Page } from "playwright-core";
import { sanitizeErrorMessage } from "../../utils/sanitize.js";
import type { AgentActionRecord, AgentActionType } from "./types.js";

export const ACTIONS_PER_LOOP = 10;
export const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
/** After this many consecutive failures the rest of the loop is skipped, so a dead page cannot burn a timeout per action. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface LoopSelectors {
  /** Present on every page the loop lands on. */
  heading: string;
  /** The link the loop clicks; must lead to a page that also has `heading`. */
  link: string;
}

/** Namespaced pages (files, categories, help) are not articles and are excluded from the click target. */
const WIKIPEDIA_NAMESPACES = [
  "File", "Help", "Wikipedia", "Special", "Category", "Template", "Portal", "Talk", "Draft", "Module", "MediaWiki", "User",
];

/**
 * Wikipedia article pages. Links are matched by `/wiki/` anywhere in the href
 * because Wikipedia serves them absolute (`https://en.wikipedia.org/wiki/X`),
 * and older renderings used `/wiki/X` or `./X`. Namespaces are excluded by
 * name, since a `:` test would also match the URL scheme. Paragraph links
 * only: infobox and hatnote links are often collapsed or hidden.
 */
export const WIKIPEDIA_SELECTORS: LoopSelectors = {
  heading: "#firstHeading",
  link:
    '#mw-content-text p a:is([href*="/wiki/"], [href^="./"])' +
    WIKIPEDIA_NAMESPACES.map((ns) => `:not([href*="${ns}:"])`).join(""),
};

interface Step {
  type: AgentActionType;
  run: (page: Page) => Promise<unknown>;
}

/**
 * One loop: ten actions that mirror an agent's turn. Navigate, wait for the
 * DOM, capture a screenshot for the model, read some text, act, observe the
 * result, step back. `goBack` waits for `commit` because a page restored from
 * the back-forward cache never fires `load`; the following `waitForSelector`
 * confirms arrival.
 */
export type ClickMode = "mouse" | "dom";

export function loopSteps(url: string, sel: LoopSelectors, timeout: number, clickMode: ClickMode = "mouse"): Step[] {
  const wait: Step = {
    type: "waitForSelector",
    run: (p) => p.waitForSelector(sel.heading, { timeout }),
  };
  const screenshot: Step = {
    type: "screenshot",
    run: (p) => p.screenshot({ type: "png", timeout }),
  };
  const read: Step = {
    type: "textContent",
    run: (p) => p.textContent(sel.heading, { timeout }),
  };
  return [
    { type: "navigate", run: (p) => p.goto(url, { waitUntil: "domcontentloaded", timeout }) },
    wait,
    screenshot,
    read,
    clickMode === "mouse"
      // The first *visible* match: Playwright would otherwise wait out the
      // timeout on a link that is in the DOM but collapsed.
      ? { type: "click", run: (p) => p.locator(sel.link).filter({ visible: true }).first().click({ timeout }) }
      // No layout means no visibility: click the first match through the DOM
      // and wait for the navigation to commit, as a mouse click would.
      : { type: "click", run: async (p) => {
          const before = p.url();
          await Promise.all([
            p.waitForURL((u) => u.toString() !== before, { waitUntil: "commit", timeout }),
            p.locator(sel.link).first().evaluate((a) => (a as HTMLElement).click(), undefined, { timeout }),
          ]);
        } },
    wait,
    screenshot,
    read,
    { type: "goBack", run: (p) => p.goBack({ waitUntil: "commit", timeout }) },
    wait,
  ];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * Runs `loops` loops on `page`, timing every action individually. A failing
 * action is recorded and the loop moves on, so partial completion is visible;
 * only a run of consecutive failures skips the remainder of that loop.
 */
export async function runActionLoops(
  page: Page,
  urlForLoop: (loop: number) => string,
  loops: number,
  options: { selectors?: LoopSelectors; timeoutMs?: number; clickMode?: ClickMode; log?: (line: string) => void } = {}
): Promise<AgentActionRecord[]> {
  const sel = options.selectors ?? WIKIPEDIA_SELECTORS;
  const timeout = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const log = options.log ?? (() => {});
  const records: AgentActionRecord[] = [];
  let index = 0;

  for (let loop = 1; loop <= loops; loop++) {
    const steps = loopSteps(urlForLoop(loop), sel, timeout, options.clickMode);
    let consecutiveFailures = 0;

    for (const step of steps) {
      index++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        records.push({
          index,
          loop,
          type: step.type,
          duration_ms: 0,
          success: false,
          error_message: `skipped after ${consecutiveFailures} consecutive failures`,
          skipped: true,
        });
        continue;
      }

      const t0 = performance.now();
      let success = false;
      let error: string | null = null;
      try {
        // Playwright's own timeout fires first; the guard only catches a call
        // that does not honour it.
        await withTimeout(step.run(page), timeout + 1_000, step.type);
        success = true;
      } catch (e: unknown) {
        error = sanitizeErrorMessage(e instanceof Error ? e.message : `${e}`).split("\n")[0]!;
      }
      const duration = Math.round((performance.now() - t0) * 100) / 100;

      records.push({ index, loop, type: step.type, duration_ms: duration, success, error_message: error, skipped: false });
      consecutiveFailures = success ? 0 : consecutiveFailures + 1;
      log(`[ACTION ${index}] loop=${loop} ${step.type} ${duration}ms ${success ? "ok" : `FAIL ${error}`}`);
    }
  }

  return records;
}

export interface ActionSummary {
  actions_total: number;
  actions_completed: number;
  task_ms: number;
  actions_per_second: number | null;
  first_loop_ms: number | null;
  last_loop_ms: number | null;
}

/** Session-level numbers derived from the action list, so they always add up. */
export function summarizeActions(actions: AgentActionRecord[], loops: number): ActionSummary {
  const completed = actions.filter((a) => a.success).length;
  const taskMs = Math.round(actions.reduce((sum, a) => sum + a.duration_ms, 0) * 100) / 100;
  const loopMs = (loop: number) => {
    const inLoop = actions.filter((a) => a.loop === loop);
    if (inLoop.length === 0) return null;
    return Math.round(inLoop.reduce((sum, a) => sum + a.duration_ms, 0) * 100) / 100;
  };
  return {
    actions_total: actions.length,
    actions_completed: completed,
    task_ms: taskMs,
    actions_per_second: taskMs > 0 ? Math.round((completed / (taskMs / 1000)) * 100) / 100 : null,
    first_loop_ms: loopMs(1),
    last_loop_ms: loopMs(loops),
  };
}
