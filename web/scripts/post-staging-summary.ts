/**
 * Posts the daily Notte staging vs production summary to the BrowserArena
 * Slack channel when something is red (a missed run, a gross gap to
 * production, or a regression against staging's own history); a quiet day
 * posts nothing. Run by .github/workflows/staging-summary.yml after the
 * staging runs (20:00/21:00 UTC), and by hand:
 *
 *   INTERNAL_RESULTS_GITHUB_TOKEN=... npx tsx scripts/post-staging-summary.ts --dry-run
 *   ... --date 2026-11-09
 *
 * Staging numbers are private and this repo's Actions logs are public, so the
 * script never prints them in CI: --dry-run is refused there and posting logs
 * only the outcome.
 */

import { stagingResultsSource } from "../lib/internal-staging";
import { stagingSummary } from "../lib/staging-summary";
import { loadStagingSummaryInput } from "../lib/staging-summary-data";

const PAGE_URL = "https://staging-console.notte.cc/api/admin/browserarena-internal";

function fail(message: string): never {
  console.error(`[staging-summary] ${message}`);
  process.exit(1);
}

function parseDate(argv: string[]): string {
  const i = argv.indexOf("--date");
  const date = i >= 0 ? argv[i + 1] ?? "" : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail(`invalid --date ${date}`);
  return date;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  if (dryRun && process.env.GITHUB_ACTIONS === "true") fail("--dry-run would print private staging numbers into public Actions logs");
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!dryRun && !webhook) fail("SLACK_WEBHOOK_URL is not set");
  const date = parseDate(argv);

  const source = stagingResultsSource();
  if (!source) fail("INTERNAL_RESULTS_GITHUB_TOKEN is not set");
  const { alert, message } = stagingSummary(await loadStagingSummaryInput(date, source, PAGE_URL));

  if (dryRun) {
    console.log(JSON.stringify({ alert, message }, null, 2));
    return;
  }
  if (!alert) {
    console.log(`[staging-summary] nothing red on ${date}; not posted`);
    return;
  }
  const res = await fetch(webhook!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) });
  if (!res.ok) fail(`Slack POST failed: HTTP ${res.status}`);
  console.log(`[staging-summary] posted the ${date} summary`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
