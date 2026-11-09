/**
 * Daily Slack summary: Notte staging (us-staging.notte.cc, 20:00/21:00 UTC)
 * next to Notte production (04:00/06:00 UTC). Pure: the script loads the
 * numbers and posts; this only formats them. Staging numbers are private, so
 * the payload must only ever go to the team's Slack webhook.
 */

export interface LifecycleNumbers {
  runDate?: string;
  totalRuns: number;
  successRate: number;
  /** Sum of phase medians, the site's headline latency. */
  totalTimeMs: number;
  p90TotalMs: number;
}

export interface ThroughputNumbers {
  runDate?: string;
  totalRuns: number;
  successRate: number;
  actionsPerSecond: number;
  taskMs: number;
}

export interface StagingSummaryInput {
  /** UTC day the staging run is expected for. */
  date: string;
  lifecycle: { concurrency: number; prod: LifecycleNumbers | null; staging: LifecycleNumbers | null }[];
  throughput: { prod: ThroughputNumbers | null; staging: ThroughputNumbers | null };
  /** Opens the team-only page through the console's superadmin link. */
  pageUrl: string;
}

// Same investigation signals as the monorepo's browserarena-benchmark skill:
// latency must be worse by both a share and an absolute amount.
const LATENCY_SHARE = 0.1;
const LATENCY_MS = 100;

function ms(value: number): string {
  return `${Math.round(value)} ms`;
}

function pct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** "+121 ms (+40%)" for staging against production. */
function delta(staging: number, prod: number, unit: "ms" | "/s"): string {
  const diff = staging - prod;
  const share = prod ? (diff / prod) * 100 : 0;
  const sign = diff >= 0 ? "+" : "−";
  const amount = unit === "ms" ? `${Math.round(Math.abs(diff))} ms` : `${Math.abs(diff).toFixed(2)}/s`;
  return `${sign}${amount} (${sign}${Math.abs(Math.round(share))}%)`;
}

function slowerMs(staging: number, prod: number): boolean {
  return staging - prod > LATENCY_MS && staging > prod * (1 + LATENCY_SHARE);
}

function lifecycleLines(row: StagingSummaryInput["lifecycle"][number], date: string): { text: string; flagged: boolean } {
  const { prod, staging, concurrency } = row;
  const head = `*c${concurrency}*`;
  if (!staging || staging.runDate !== date) {
    return { text: `${head} ⚠️ No staging run for ${date}${staging?.runDate ? ` (latest ${staging.runDate})` : ""}.`, flagged: true };
  }
  const stagingLine = `staging ${pct(staging.successRate)} ok · ${ms(staging.totalTimeMs)} · p90 ${ms(staging.p90TotalMs)} · ${staging.totalRuns} runs`;
  if (!prod) return { text: `${head} ${stagingLine}\nNo production run to compare.`, flagged: false };
  const flagged = staging.successRate < prod.successRate || slowerMs(staging.totalTimeMs, prod.totalTimeMs) || slowerMs(staging.p90TotalMs, prod.p90TotalMs);
  return {
    flagged,
    text:
      `${head}${flagged ? " ⚠️" : ""}\n` +
      `• production ${pct(prod.successRate)} ok · ${ms(prod.totalTimeMs)} · p90 ${ms(prod.p90TotalMs)} · ${prod.totalRuns} runs (${prod.runDate ?? "?"})\n` +
      `• ${stagingLine}\n` +
      `• staging vs production: ${delta(staging.totalTimeMs, prod.totalTimeMs, "ms")} · p90 ${delta(staging.p90TotalMs, prod.p90TotalMs, "ms")}`,
  };
}

function throughputLines(row: StagingSummaryInput["throughput"], date: string): { text: string; flagged: boolean } {
  const { prod, staging } = row;
  if (!staging || staging.runDate !== date) {
    return { text: `⚠️ No staging run for ${date}${staging?.runDate ? ` (latest ${staging.runDate})` : ""}.`, flagged: true };
  }
  const stagingLine = `staging ${pct(staging.successRate)} ok · ${staging.actionsPerSecond.toFixed(2)} actions/s · task ${ms(staging.taskMs)} · ${staging.totalRuns} runs`;
  if (!prod) return { text: `${stagingLine}\nNo production run to compare.`, flagged: false };
  const flagged = staging.successRate < prod.successRate || staging.actionsPerSecond < prod.actionsPerSecond * (1 - LATENCY_SHARE);
  return {
    flagged,
    text:
      `${flagged ? "⚠️\n" : ""}` +
      `• production ${pct(prod.successRate)} ok · ${prod.actionsPerSecond.toFixed(2)} actions/s · task ${ms(prod.taskMs)} · ${prod.totalRuns} runs (${prod.runDate ?? "?"})\n` +
      `• ${stagingLine}\n` +
      `• staging vs production: ${delta(staging.actionsPerSecond, prod.actionsPerSecond, "/s")} actions/s · task ${delta(staging.taskMs, prod.taskMs, "ms")}`,
  };
}

export function stagingSummaryMessage(input: StagingSummaryInput) {
  const lifecycle = input.lifecycle.map((row) => lifecycleLines(row, input.date));
  const throughput = throughputLines(input.throughput, input.date);
  const flagged = lifecycle.some((l) => l.flagged) || throughput.flagged;
  const title = `${flagged ? "⚠️" : "✅"} Notte staging vs production — ${input.date}`;
  return {
    text: title,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*Browser Lifecycle* (headline = sum of phase medians)\n${lifecycle.map((l) => l.text).join("\n")}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Browser Throughput* (sequential)\n${throughput.text}` } },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text:
            "Same runner (us-west-1) and settings. Staging runs at 20:00 UTC against us-staging.notte.cc, " +
            `about eight hours before the next production run. ⚠️ = staging is worse by more than ${LATENCY_SHARE * 100}% ` +
            `and ${LATENCY_MS} ms, has a lower success rate, or did not run.`,
        }],
      },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open comparison (superadmins)" }, url: input.pageUrl }],
      },
    ],
  };
}
