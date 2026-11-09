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
  /** `stagingRan`: the day's run folder exists, even if it holds no samples. */
  lifecycle: { concurrency: number; prod: LifecycleNumbers | null; staging: LifecycleNumbers | null; stagingRan?: boolean }[];
  throughput: { prod: ThroughputNumbers | null; staging: ThroughputNumbers | null; stagingRan?: boolean };
  /** Opens the team-only page through the console's superadmin link. */
  pageUrl: string;
}

// Same investigation signals as the monorepo's browserarena-benchmark skill:
// latency is red only when worse by both a share and an absolute amount.
const LATENCY_SHARE = 0.1;
const LATENCY_MS = 100;
/** Success rate down by at least this many points is red; less is yellow. */
const SUCCESS_POINTS = 2;

type Level = "good" | "watch" | "bad";
const DOT: Record<Level, string> = { good: "🟢", watch: "🟡", bad: "🔴" };

interface Row {
  label: string;
  prod: string;
  staging: string;
  change: string;
  level: Level;
  /** Starts a new group (another concurrency level): a blank line goes before it. */
  groupStart?: boolean;
}

/** A compared metric, kept for the headline's "biggest gap". */
interface Gap {
  name: string;
  prod: string;
  staging: string;
  /** How much worse staging is, as a ratio (1 = equal). */
  ratio: number;
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const msText = (n: number) => `${int(n)} ms`;
const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** "+4%", "−35%", or "5.4×" once staging is more than twice production. */
function change(staging: number, prod: number): string {
  if (!prod) return "—";
  const ratio = staging / prod;
  if (ratio >= 2) return `${ratio.toFixed(1)}×`;
  const share = Math.round((ratio - 1) * 100);
  return share === 0 ? "=" : `${share > 0 ? "+" : "−"}${Math.abs(share)}%`;
}

/** Lower is better (milliseconds). */
function latencyLevel(staging: number, prod: number): Level {
  const worseMs = staging - prod;
  const worseShare = prod ? worseMs / prod : 0;
  if (worseMs > LATENCY_MS && worseShare > LATENCY_SHARE) return "bad";
  if (worseMs > LATENCY_MS || worseShare > LATENCY_SHARE) return "watch";
  return "good";
}

/** Higher is better (actions per second). */
function rateLevel(staging: number, prod: number): Level {
  if (staging < prod * (1 - LATENCY_SHARE)) return "bad";
  if (staging < prod) return "watch";
  return "good";
}

function successLevel(staging: number, prod: number): Level {
  const down = prod - staging;
  if (down >= SUCCESS_POINTS) return "bad";
  return down > 0 ? "watch" : "good";
}

function successChange(staging: number, prod: number): string {
  const diff = Math.round((staging - prod) * 10) / 10;
  return diff === 0 ? "=" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} pt`;
}

/** Aligned monospace table. The dot goes last so emoji width cannot skew columns. */
function table(rows: Row[]): string {
  const header: Row = { label: "", prod: "Production", staging: "Staging", change: "Change", level: "good" };
  const all = [header, ...rows];
  const width = (key: "label" | "prod" | "staging" | "change") => Math.max(...all.map((r) => r[key].length));
  const w = { label: width("label"), prod: width("prod"), staging: width("staging"), change: width("change") };
  const line = (r: Row, dot: string) =>
    `${r.label.padEnd(w.label)}  ${r.prod.padStart(w.prod)}  ${r.staging.padStart(w.staging)}  ${r.change.padStart(w.change)}  ${dot}`.trimEnd();
  const body = rows.map((r, i) => `${r.groupStart && i > 0 ? "\n" : ""}${line(r, DOT[r.level])}`);
  return "```\n" + [line(header, ""), ...body].join("\n") + "\n```";
}

function missing(date: string, ran: boolean | undefined, latest?: string): string {
  return ran
    ? `🔴 Staging ran on ${date} but recorded no samples (see its _meta.json run_status).`
    : `🔴 No staging run for ${date}${latest ? ` (latest is ${latest})` : ""}.`;
}

interface Section {
  text: string;
  rows: Row[];
  gaps: Gap[];
  /** A missing run counts as red. */
  missingRun: boolean;
}

function lifecycleSection(input: StagingSummaryInput): Section {
  const rows: Row[] = [];
  const gaps: Gap[] = [];
  const notes: string[] = [];
  for (const { concurrency, prod, staging, stagingRan } of input.lifecycle) {
    const level = `c${concurrency}`;
    if (!staging || staging.runDate !== input.date) {
      notes.push(`${level}: ${missing(input.date, stagingRan, staging?.runDate)}`);
      continue;
    }
    const p = (pick: (n: LifecycleNumbers) => string) => (prod ? pick(prod) : "—");
    rows.push(
      { label: `${level} median`, prod: p((n) => msText(n.totalTimeMs)), staging: msText(staging.totalTimeMs), change: prod ? change(staging.totalTimeMs, prod.totalTimeMs) : "—", level: prod ? latencyLevel(staging.totalTimeMs, prod.totalTimeMs) : "good", groupStart: true },
      { label: `${level} p90`, prod: p((n) => msText(n.p90TotalMs)), staging: msText(staging.p90TotalMs), change: prod ? change(staging.p90TotalMs, prod.p90TotalMs) : "—", level: prod ? latencyLevel(staging.p90TotalMs, prod.p90TotalMs) : "good" },
      { label: `${level} success`, prod: p((n) => pctText(n.successRate)), staging: pctText(staging.successRate), change: prod ? successChange(staging.successRate, prod.successRate) : "—", level: prod ? successLevel(staging.successRate, prod.successRate) : "good" },
    );
    if (prod) {
      gaps.push(
        { name: `${level} median`, prod: msText(prod.totalTimeMs), staging: msText(staging.totalTimeMs), ratio: staging.totalTimeMs / prod.totalTimeMs },
        { name: `${level} p90`, prod: msText(prod.p90TotalMs), staging: msText(staging.p90TotalMs), ratio: staging.p90TotalMs / prod.p90TotalMs },
      );
    } else {
      notes.push(`${level}: no production run for ${input.date} to compare.`);
    }
  }
  const body = [rows.length ? table(rows) : "", ...notes].filter(Boolean).join("\n");
  return {
    text: `*⏱️ Browser Lifecycle* — create → connect → navigate → release, lower is better\n${body}`,
    rows,
    gaps,
    missingRun: notes.some((n) => n.includes("🔴")),
  };
}

function throughputSection(input: StagingSummaryInput): Section {
  const { prod, staging, stagingRan } = input.throughput;
  const title = "*⚡ Browser Throughput* — actions inside one session, sequential";
  if (!staging || staging.runDate !== input.date) {
    return { text: `${title}\n${missing(input.date, stagingRan, staging?.runDate)}`, rows: [], gaps: [], missingRun: true };
  }
  const p = (pick: (n: ThroughputNumbers) => string) => (prod ? pick(prod) : "—");
  const rows: Row[] = [
    { label: "actions/s", prod: p((n) => n.actionsPerSecond.toFixed(2)), staging: staging.actionsPerSecond.toFixed(2), change: prod ? change(staging.actionsPerSecond, prod.actionsPerSecond) : "—", level: prod ? rateLevel(staging.actionsPerSecond, prod.actionsPerSecond) : "good" },
    { label: "task time", prod: p((n) => msText(n.taskMs)), staging: msText(staging.taskMs), change: prod ? change(staging.taskMs, prod.taskMs) : "—", level: prod ? latencyLevel(staging.taskMs, prod.taskMs) : "good" },
    { label: "success", prod: p((n) => pctText(n.successRate)), staging: pctText(staging.successRate), change: prod ? successChange(staging.successRate, prod.successRate) : "—", level: prod ? successLevel(staging.successRate, prod.successRate) : "good" },
  ];
  const gaps: Gap[] = prod
    ? [
        { name: "throughput", prod: `${prod.actionsPerSecond.toFixed(2)} actions/s`, staging: `${staging.actionsPerSecond.toFixed(2)} actions/s`, ratio: prod.actionsPerSecond / staging.actionsPerSecond },
        { name: "task time", prod: msText(prod.taskMs), staging: msText(staging.taskMs), ratio: staging.taskMs / prod.taskMs },
      ]
    : [];
  const note = prod ? "" : `\nNo production run for ${input.date} to compare.`;
  return { text: `${title}\n${table(rows)}${note}`, rows, gaps, missingRun: false };
}

function headline(sections: Section[]): { emoji: string; text: string } {
  const rows = sections.flatMap((s) => s.rows);
  const bad = rows.filter((r) => r.level === "bad").length;
  const watch = rows.filter((r) => r.level === "watch").length;
  const missingRun = sections.some((s) => s.missingRun);
  const worst = sections.flatMap((s) => s.gaps).sort((a, b) => b.ratio - a.ratio)[0];
  const gap = worst && worst.ratio >= 1 + LATENCY_SHARE
    ? ` Biggest gap: ${worst.name}, ${worst.staging} on staging vs ${worst.prod} on production (${worst.ratio >= 2 ? `${worst.ratio.toFixed(1)}× worse` : `${Math.round((worst.ratio - 1) * 100)}% worse`}).`
    : "";
  if (missingRun) return { emoji: "🔴", text: `Staging did not run completely.${bad ? ` ${bad} of ${rows.length} metrics are worse than production.` : ""}${gap}` };
  if (bad) return { emoji: "🔴", text: `Staging is worse than production on ${bad} of ${rows.length} metrics.${gap}` };
  if (watch) return { emoji: "🟡", text: `Staging is close to production; ${watch} of ${rows.length} metrics are slightly worse.${gap}` };
  return { emoji: "🟢", text: "Staging matches production on every metric." };
}

function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function stagingSummaryMessage(input: StagingSummaryInput) {
  const sections = [lifecycleSection(input), throughputSection(input)];
  const verdict = headline(sections);
  const title = `${verdict.emoji} Notte staging vs production · ${prettyDate(input.date)}`;
  return {
    text: `${title}: ${verdict.text}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${verdict.text}*` } },
      { type: "divider" },
      ...sections.map((section) => ({ type: "section", text: { type: "mrkdwn", text: section.text } })),
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text:
            `🟢 same or better  🟡 slightly worse  🔴 worse by >${LATENCY_SHARE * 100}% and >${LATENCY_MS} ms, success down ≥${SUCCESS_POINTS} pt, or no run · ` +
            "median = sum of phase medians (the site's headline) · " +
            "🧪 staging ran 20:00 UTC on us-staging.notte.cc, 🚀 production 04:00 UTC, same us-west-1 runner",
        }],
      },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "📊 Open comparison (superadmins)" }, url: input.pageUrl }],
      },
    ],
  };
}
