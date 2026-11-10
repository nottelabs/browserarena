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

/** "none": nothing to compare against; "info": a plain count with no verdict. */
type Level = "good" | "watch" | "bad" | "none" | "info";
const DOT: Record<Level, string> = { good: "🟢", watch: "🟡", bad: "🔴", none: "⚪", info: "" };

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
  /** How much worse staging is, as a finite ratio (1 = equal). */
  ratio: number;
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const msText = (n: number) => `${int(n)} ms`;
const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const rateText = (n: number) => n.toFixed(2);

/** "+4%", "−35%", or "5.4×" once staging is more than twice production. */
function change(staging: number, prod: number): string {
  const ratio = staging / prod;
  if (ratio >= 2) return `${ratio.toFixed(1)}×`;
  const share = Math.round((ratio - 1) * 100);
  return share === 0 ? "=" : `${share > 0 ? "+" : "−"}${Math.abs(share)}%`;
}

function successChange(staging: number, prod: number): string {
  const diff = Math.round((staging - prod) * 10) / 10;
  return diff === 0 ? "=" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} pt`;
}

/** Lower is better (milliseconds). */
function latencyLevel(staging: number, prod: number): Level {
  const worseMs = staging - prod;
  const worseShare = worseMs / prod;
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

type Kind = "latency" | "rate" | "success";

/**
 * One table row. Latency and rate are medians of successful samples, so 0
 * means "nothing measured" (every session failed), never "instant": it shows
 * as "—", cannot be compared, and never enters the biggest-gap ranking.
 */
function metric(label: string, kind: Kind, prod: number | null, staging: number): { row: Row; gap?: Gap } {
  const fmt = kind === "latency" ? msText : kind === "rate" ? rateText : pctText;
  const measured = (v: number | null): v is number => v !== null && Number.isFinite(v) && (kind === "success" || v > 0);
  const row: Row = { label, prod: measured(prod) ? fmt(prod) : "—", staging: measured(staging) ? fmt(staging) : "—", change: "—", level: "none" };
  if (!measured(prod)) return { row };
  if (!measured(staging)) return { row: { ...row, level: "bad" } };
  if (kind === "success") return { row: { ...row, change: successChange(staging, prod), level: successLevel(staging, prod) } };
  const level = kind === "latency" ? latencyLevel(staging, prod) : rateLevel(staging, prod);
  const ratio = kind === "latency" ? staging / prod : prod / staging;
  return {
    row: { ...row, change: change(staging, prod), level },
    gap: { name: label, prod: kind === "rate" ? `${fmt(prod)} actions/s` : fmt(prod), staging: kind === "rate" ? `${fmt(staging)} actions/s` : fmt(staging), ratio },
  };
}

/** Sample counts: few completed runs make any comparison weaker. */
function runsRow(label: string, prod: { totalRuns: number } | null, staging: { totalRuns: number }): Row {
  return { label, prod: prod ? int(prod.totalRuns) : "—", staging: int(staging.totalRuns), change: "", level: "info" };
}

/** Aligned monospace table. The dot goes last so emoji width cannot skew columns. */
function table(rows: Row[]): string {
  const header: Row = { label: "", prod: "Production", staging: "Staging", change: "Change", level: "info" };
  const all = [header, ...rows];
  const width = (key: "label" | "prod" | "staging" | "change") => Math.max(...all.map((r) => r[key].length));
  const w = { label: width("label"), prod: width("prod"), staging: width("staging"), change: width("change") };
  const line = (r: Row) =>
    `${r.label.padEnd(w.label)}  ${r.prod.padStart(w.prod)}  ${r.staging.padStart(w.staging)}  ${r.change.padStart(w.change)}  ${DOT[r.level]}`.trimEnd();
  const body = rows.map((r, i) => `${r.groupStart && i > 0 ? "\n" : ""}${line(r)}`);
  return "```\n" + [line(header), ...body].join("\n") + "\n```";
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

function collect(results: { row: Row; gap?: Gap }[], rows: Row[], gaps: Gap[]) {
  for (const { row, gap } of results) {
    rows.push(row);
    if (gap) gaps.push(gap);
  }
}

function lifecycleSection(input: StagingSummaryInput): Section {
  const rows: Row[] = [];
  const gaps: Gap[] = [];
  const notes: string[] = [];
  for (const { concurrency, prod, staging, stagingRan } of input.lifecycle) {
    const group = `c${concurrency}`;
    if (!staging || staging.runDate !== input.date) {
      notes.push(`${group}: ${missing(input.date, stagingRan, staging?.runDate)}`);
      continue;
    }
    const start = rows.length;
    collect([
      metric(`${group} median`, "latency", prod?.totalTimeMs ?? null, staging.totalTimeMs),
      metric(`${group} p90`, "latency", prod?.p90TotalMs ?? null, staging.p90TotalMs),
      metric(`${group} success`, "success", prod?.successRate ?? null, staging.successRate),
    ], rows, gaps);
    rows.push(runsRow(`${group} runs`, prod, staging));
    rows[start]!.groupStart = true;
    if (!prod) notes.push(`⚪ ${group}: no production run for ${input.date} to compare.`);
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
  const rows: Row[] = [];
  const gaps: Gap[] = [];
  collect([
    metric("actions/s", "rate", prod?.actionsPerSecond ?? null, staging.actionsPerSecond),
    metric("task time", "latency", prod?.taskMs ?? null, staging.taskMs),
    metric("success", "success", prod?.successRate ?? null, staging.successRate),
  ], rows, gaps);
  rows.push(runsRow("runs", prod, staging));
  const note = prod ? "" : `\n⚪ No production run for ${input.date} to compare.`;
  return { text: `${title}\n${table(rows)}${note}`, rows, gaps, missingRun: false };
}

function headline(sections: Section[]): { emoji: string; text: string } {
  const rows = sections.flatMap((s) => s.rows).filter((r) => r.level !== "info");
  const count = (level: Level) => rows.filter((r) => r.level === level).length;
  const [bad, watch, none] = [count("bad"), count("watch"), count("none")];
  const missingRun = sections.some((s) => s.missingRun);
  const worst = sections.flatMap((s) => s.gaps).sort((a, b) => b.ratio - a.ratio)[0];
  const gap = worst && worst.ratio >= 1 + LATENCY_SHARE
    ? ` Biggest gap: ${worst.name}, ${worst.staging} on staging vs ${worst.prod} on production (${worst.ratio >= 2 ? `${worst.ratio.toFixed(1)}× worse` : `${Math.round((worst.ratio - 1) * 100)}% worse`}).`
    : "";
  const incomplete = none ? ` ${none} of ${rows.length} metrics have no production baseline.` : "";
  if (missingRun) return { emoji: "🔴", text: `Staging did not run completely.${bad ? ` ${bad} of ${rows.length} metrics are worse than production.` : ""}${incomplete}${gap}` };
  if (bad) return { emoji: "🔴", text: `Staging is worse than production on ${bad} of ${rows.length} metrics.${incomplete}${gap}` };
  if (none) return { emoji: "⚪", text: `Comparison incomplete:${incomplete}${watch ? ` ${watch} compared metrics are slightly worse.` : ""}${gap}` };
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
            `🟢 same or better  🟡 slightly worse  🔴 worse by >${LATENCY_SHARE * 100}% and >${LATENCY_MS} ms, success down ≥${SUCCESS_POINTS} pt, or no run  ⚪ not compared · ` +
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
