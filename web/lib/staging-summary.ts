/**
 * Daily Slack alert: Notte staging (us-staging.notte.cc, 20:00/21:00 UTC)
 * against its own history and next to Notte production (04:00/06:00 UTC).
 * Pure: the script loads the numbers and posts; this only formats them and
 * decides whether anything is worth posting. Staging numbers are private, so
 * the payload must only ever go to the team's Slack webhook.
 *
 * Staging keeps far fewer warm browsers than production and runs at a busier
 * hour, so a small or tail gap to production measures capacity, not code.
 * Production is therefore compared on step medians only, and only a gross gap
 * is red; staging's own history is the regression check.
 */

/** Medians of successful sessions, per lifecycle step. */
export interface LifecycleSteps {
  creation: number;
  connect: number;
  goto: number;
  release: number;
}

export interface LifecycleNumbers {
  runDate?: string;
  totalRuns: number;
  successRate: number;
  steps: LifecycleSteps;
}

export interface ThroughputNumbers {
  runDate?: string;
  totalRuns: number;
  successRate: number;
  actionsPerSecond: number;
  taskMs: number;
}

/** Staging against its own earlier runs (production's regression detector rules). */
export interface BaselineCheck {
  concurrency: number;
  /** "unknown": not enough run-days yet to judge. */
  status: "ok" | "degraded" | "unknown";
  runDays: number;
  runDaysNeeded: number;
  /** Headline latency: baseline vs the median of the last 3 runs. */
  total: { baseline: number; current: number } | null;
  breaches: { label: string; unit: "ms" | "percent"; baseline: number; current: number; ratio: number; onsetDate: string | null }[];
}

export interface StagingSummaryInput {
  /** UTC day the staging run is expected for. */
  date: string;
  /** `stagingRan`: the day's run folder exists, even if it holds no samples. */
  lifecycle: { concurrency: number; prod: LifecycleNumbers | null; staging: LifecycleNumbers | null; stagingRan?: boolean }[];
  throughput: { prod: ThroughputNumbers | null; staging: ThroughputNumbers | null; stagingRan?: boolean };
  /** One per lifecycle concurrency level staging ran on `date`. */
  baseline?: BaselineCheck[];
  /** Opens the team-only page through the console's superadmin link. */
  pageUrl: string;
}

/**
 * A gross gap to production: staging at least this many times slower (or
 * this share of the throughput)...
 */
const GROSS_RATIO = 2;
/** ...and slower by at least this much, so a 20 ms step doubling to 40 ms stays quiet. */
const GROSS_MS = 100;
/** Success rate down by at least this many points. */
const SUCCESS_POINTS = 10;

const STEPS: { key: keyof LifecycleSteps; label: string }[] = [
  { key: "creation", label: "create" },
  { key: "connect", label: "connect" },
  { key: "goto", label: "navigate" },
  { key: "release", label: "release" },
];

/** "none": nothing to compare against; "info": a plain count with no verdict. */
type Level = "good" | "bad" | "none" | "info";
const DOT: Record<Level, string> = { good: "🟢", bad: "🔴", none: "⚪", info: "" };

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
  return staging >= prod * GROSS_RATIO && staging - prod >= GROSS_MS ? "bad" : "good";
}

/** Higher is better (actions per second). */
function rateLevel(staging: number, prod: number): Level {
  return staging * GROSS_RATIO <= prod ? "bad" : "good";
}

function successLevel(staging: number, prod: number): Level {
  return prod - staging >= SUCCESS_POINTS ? "bad" : "good";
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
      ...STEPS.map(({ key, label }) => metric(`${group} ${label}`, "latency", prod?.steps[key] ?? null, staging.steps[key])),
      metric(`${group} success`, "success", prod?.successRate ?? null, staging.successRate),
    ], rows, gaps);
    rows.push(runsRow(`${group} runs`, prod, staging));
    rows[start]!.groupStart = true;
    if (!prod) notes.push(`⚪ ${group}: no production run for ${input.date} to compare.`);
  }
  const body = [rows.length ? table(rows) : "", ...notes].filter(Boolean).join("\n");
  return {
    text: `*⏱️ Browser Lifecycle* — median of each step, lower is better\n${body}`,
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

function breachText(b: BaselineCheck["breaches"][number]): string {
  const since = b.onsetDate ? ` since ${b.onsetDate}` : "";
  if (b.unit === "percent") return `${b.label} ${pctText(b.baseline)} → ${pctText(b.current)}${since}`;
  return `${b.label} ${msText(b.baseline)} → ${msText(b.current)} (${b.ratio.toFixed(1)}×)${since}`;
}

/** Staging against itself: the check that catches a code regression. */
function baselineSection(checks: BaselineCheck[]): string | null {
  if (!checks.length) return null;
  const lines = checks.map((c) => {
    const group = `c${c.concurrency}`;
    if (c.status === "unknown") return `⚪ ${group}: ${c.runDays} of ${c.runDaysNeeded} run-days so far, not judged yet.`;
    if (c.status === "degraded") return `🔴 ${group}: ${c.breaches.map(breachText).join("; ")}.`;
    const total = c.total ? ` (median ${msText(c.total.current)} over the last 3 runs, ${msText(c.total.baseline)} before)` : "";
    return `🟢 ${group}: within its baseline${total}.`;
  });
  return `*📈 Staging vs its own history* — Browser Lifecycle, production's regression-alert rules\n${lines.join("\n")}`;
}

/** The comparison with production: red only for a missed run or a gross gap. */
function headline(sections: Section[]): { red: boolean; text: string } {
  const rows = sections.flatMap((s) => s.rows).filter((r) => r.level !== "info");
  const bad = rows.filter((r) => r.level === "bad").length;
  const none = rows.filter((r) => r.level === "none").length;
  const missingRun = sections.some((s) => s.missingRun);
  const worst = sections.flatMap((s) => s.gaps).sort((a, b) => b.ratio - a.ratio)[0];
  const gap = bad && worst && worst.ratio >= GROSS_RATIO
    ? ` Biggest gap: ${worst.name}, ${worst.staging} on staging vs ${worst.prod} on production (${worst.ratio.toFixed(1)}× worse).`
    : "";
  const far = bad ? ` Staging is far behind production on ${bad} of ${rows.length} metrics.` : "";
  if (missingRun) return { red: true, text: `Staging did not run completely.${far}${gap}` };
  if (bad) return { red: true, text: `${far.trim()}${gap}` };
  if (none) return { red: false, text: `No gross gap to production; ${none} of ${rows.length} metrics have no production run to compare.` };
  return { red: false, text: `No gross gap to production.` };
}

function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * `alert`: whether the day is worth a post (a missed run, a gross gap to
 * production, or a regression against staging's own history).
 */
export function stagingSummary(input: StagingSummaryInput) {
  const sections = [lifecycleSection(input), throughputSection(input)];
  const checks = input.baseline ?? [];
  const history = baselineSection(checks);
  const comparison = headline(sections);
  const regressed = checks.filter((c) => c.status === "degraded");
  const alert = comparison.red || regressed.length > 0;
  const text = regressed.length
    ? `Staging regressed against its own history on ${regressed.map((c) => `c${c.concurrency} (${c.breaches[0] ? breachText(c.breaches[0]) : "see below"})`).join(", ")}. ${comparison.text}`
    : comparison.text;
  const title = `${alert ? "🔴" : "🟢"} Notte staging vs production · ${prettyDate(input.date)}`;
  return {
    alert,
    message: {
      text: `${title}: ${text}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: title, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: `*${text}*` } },
        { type: "divider" },
        ...[...sections.map((section) => section.text), ...(history ? [history] : [])]
          .map((text) => ({ type: "section", text: { type: "mrkdwn", text } })),
        {
          type: "context",
          elements: [{
            type: "mrkdwn",
            text:
              `Posted only when something is red · 🔴 vs production: a step ≥${GROSS_RATIO}× and +${GROSS_MS} ms slower, throughput ≤1/${GROSS_RATIO}, success down ≥${SUCCESS_POINTS} pt, or no run · ⚪ no production run · ` +
              "smaller and tail gaps are not compared: staging keeps fewer warm browsers and runs at a busier hour · " +
              "📈 history: 28-run baseline, red when ≥1.5× and +50 ms (or success −5 pt and <95%) on 2 of the last 3 runs · " +
              "🧪 staging ran 20:00 UTC on us-staging.notte.cc, 🚀 production 04:00 UTC, same us-west-1 runner",
          }],
        },
        {
          type: "actions",
          elements: [{ type: "button", text: { type: "plain_text", text: "📊 Open comparison (superadmins)" }, url: input.pageUrl }],
        },
      ],
    },
  };
}

export function stagingSummaryMessage(input: StagingSummaryInput) {
  return stagingSummary(input).message;
}
