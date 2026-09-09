/**
 * Regression alerter. Run by .github/workflows/regression-alert.yml, and by
 * hand for debugging or replay.
 *
 *   npx tsx scripts/check-regressions.ts --dry-run
 *   npx tsx scripts/check-regressions.ts --as-of 2026-09-06 --dry-run
 *
 * Dedup is edge-triggered and stateless. The detector is a pure function of
 * committed data, so diffing "what is breaching today" against "what was
 * breaching yesterday" yields exact open/close events with no state file, no
 * commit-back to main (which would race the two EC2 boxes' push-retry loop),
 * and no cache to evict. It is also replayable: `--as-of` reproduces any past
 * day's decision exactly.
 */

import {
  breachingMetricsAt,
  evaluateSeries,
  DEFAULT_CONFIG,
  METRIC_SPECS,
  type MetricKey,
  type MetricVerdict,
  type SeriesHealth,
} from "../lib/regression";
import { loadHistoricalLeaderboard } from "../lib/data";
import type { HistoricalProviderPoint } from "../lib/data-shared";

type Mode = "edge" | "staleness" | "digest";

interface Options {
  asOf: string | null;
  dryRun: boolean;
  /** The explicit --dry-run flag, distinct from "no webhook configured". */
  dryRunFlag: boolean;
  concurrency: number[];
  mode: Mode;
  providers: string[] | null;
  strict: boolean;
}

const SITE = "https://www.browserarena.ai";

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const providers = get("--providers");
  return {
    asOf: get("--as-of"),
    dryRun: argv.includes("--dry-run") || !process.env.SLACK_WEBHOOK_URL,
    dryRunFlag: argv.includes("--dry-run"),
    concurrency: (get("--concurrency") ?? "1")
      .split(",")
      .map((c) => Number(c.trim()))
      .filter((c) => Number.isFinite(c)),
    mode: (get("--mode") as Mode | null) ?? "edge",
    providers: providers
      ? providers.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean)
      : null,
    strict: argv.includes("--strict"),
  };
}

/**
 * Alerting scope. The detector evaluates every provider regardless; this only
 * decides who gets a message. `null` means every provider ("all").
 */
function alertProviders(options: Options): Set<string> | null {
  const fromEnv = process.env.ALERT_PROVIDERS?.split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const names = options.providers ?? fromEnv ?? ["NOTTE"];
  if (names.some((n) => n === "ALL")) return null;
  return new Set(names);
}

const SPARK = "▁▂▃▄▅▆▇█";

function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return SPARK[0].repeat(values.length);
  return values
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.floor(((v - min) / (max - min)) * (SPARK.length - 1)))])
    .join("");
}

function fmt(v: MetricVerdict, value: number): string {
  if (v.unit === "percent") return `${value.toFixed(1)}%`;
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function metricLine(v: MetricVerdict): string {
  const head =
    v.unit === "percent"
      ? `*${v.label}*  ${fmt(v, v.baseline)} → ${fmt(v, v.current)}  (${v.delta.toFixed(1)} pts)`
      : `*${v.label}*  ${fmt(v, v.baseline)} → ${fmt(v, v.current)}  *${v.ratio.toFixed(1)}×*  (+${fmt(v, v.delta)})`;
  const spark = sparkline(v.sparkline.map((s) => s.value));
  const nums = v.sparkline
    .slice(-7)
    .map((s) => Math.round(s.value))
    .join(" ");
  return [
    head,
    `breached ${v.breachDays} of the last ${DEFAULT_CONFIG.recentDays} days` +
      (v.onsetDate ? ` · first bad day ${v.onsetDate}` : ""),
    "`" + spark + "`  " + nums,
  ].join("\n");
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

function openedMessage(series: SeriesHealth, opened: MetricVerdict[], sha: string | undefined) {
  const worst = opened[0];
  const severe = worst.metric === "successRate" || worst.ratio >= 3;
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${severe ? "🚨" : "⚠️"} Regression — ${series.displayName} (hello-browser, c${series.concurrency})`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: opened.map(metricLine).join("\n\n") },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `Baseline = median of daily medians over ${DEFAULT_CONFIG.baselineDays} run-days, ` +
            `offset ${DEFAULT_CONFIG.recentDays} days back · ` +
            `last run ${series.lastRunDate} · ${series.daysOfHistory} days of history`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View chart" },
          url: `${SITE}/?concurrency=${series.concurrency}`,
        },
        ...(sha
          ? [
              {
                type: "button",
                text: { type: "plain_text", text: "Results commit" },
                url: `https://github.com/nottelabs/browserarena/commit/${sha}`,
              },
            ]
          : []),
      ],
    },
  ];
  return { text: `Regression: ${series.summary}`, blocks };
}

function recoveredMessage(series: SeriesHealth, closed: MetricKey[]) {
  const labels = closed
    .map((k) => METRIC_SPECS.find((s) => s.key === k)?.label ?? k)
    .join(", ");
  return {
    text: `Recovered: ${series.displayName} ${labels}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `✅ *${series.displayName}* (c${series.concurrency}) — ${labels} back within baseline as of ${series.lastRunDate}.`,
        },
      },
    ],
  };
}

function staleMessage(series: SeriesHealth, healthy: string[]) {
  return {
    text: `No results for ${series.displayName} in ${Math.round(series.ageHours ?? 0)}h`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `⚠️ *No results for ${series.displayName} in ${Math.round(series.ageHours ?? 0)}h*\n` +
            `Last run \`${series.lastRunDate}\` (expected daily). ` +
            `Check the EC2 cron and \`logs/\`.`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: healthy.length
              ? `Reporting normally: ${healthy.join(", ")}`
              : "No provider reported — both runners may be down.",
          },
        ],
      },
    ],
  };
}

async function post(payload: unknown, options: Options): Promise<void> {
  if (options.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const res = await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack POST failed: ${res.status} ${await res.text()}`);
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  // Fail loudly, and immediately, if this run was supposed to be able to post
  // but has no webhook. Otherwise a rotated or deleted secret degrades into a
  // green workflow that silently reaches nobody — the same class of failure
  // this whole system exists to catch.
  if (
    !options.dryRunFlag &&
    process.env.ALERT_REQUIRE_WEBHOOK === "true" &&
    !process.env.SLACK_WEBHOOK_URL
  ) {
    console.error(
      "[check-regressions] SLACK_WEBHOOK_URL is not set but this run is expected " +
        "to post. Alerts would be silently dropped. Set the repo secret, or pass " +
        "--dry-run."
    );
    return 1;
  }

  const scope = alertProviders(options);
  let events = 0;
  for (const [i, concurrency] of options.concurrency.entries()) {
    events += await runOne(options, scope, concurrency, i === 0);
  }
  return options.strict && events > 0 ? 1 : 0;
}

async function runOne(
  options: Options,
  scope: Set<string> | null,
  concurrency: number,
  isPrimaryLevel: boolean
): Promise<number> {
  const history = await loadHistoricalLeaderboard("hello-browser", concurrency);

  // `--as-of` truncates history so a past day's decision replays exactly.
  const truncate = (points: HistoricalProviderPoint[]) =>
    options.asOf ? points.filter((p) => p.date <= options.asOf!) : points;

  const now = options.asOf
    ? new Date(`${options.asOf}T23:59:59.000Z`)
    : new Date();

  let events = 0;
  const healthy: string[] = [];
  const staleSeries: SeriesHealth[] = [];
  const pending: { series: SeriesHealth; opened: MetricVerdict[]; closed: MetricKey[] }[] = [];

  for (const provider of history.providers) {
    const points = truncate(provider.points);
    const series = evaluateSeries(
      points,
      {
        provider: provider.provider,
        displayName: provider.displayName,
        concurrency,
      },
      now
    );

    if (series.status === "stale") staleSeries.push(series);
    else healthy.push(provider.displayName);

    if (scope && !scope.has(provider.provider)) continue;

    const n = points.length;
    const today = breachingMetricsAt(points, n - 1);
    const yesterday = breachingMetricsAt(points, n - 2);
    if (today === null) continue;

    const opened = [...today].filter((m) => !yesterday?.has(m));
    const closed = yesterday ? [...yesterday].filter((m) => !today.has(m)) : [];
    pending.push({
      series,
      opened: series.metrics
        .filter((m) => opened.includes(m.metric))
        .sort((a, b) => b.ratio - a.ratio),
      closed,
    });
  }

  const sha = process.env.GITHUB_SHA;

  for (const { series, opened, closed } of pending) {
    const isStale = series.status === "stale";

    if (options.mode === "digest") {
      // Skip stale providers: their breach numbers describe old data, and the
      // staleness message below is the one that matters. Reporting both would
      // call a regression active in the same run that says the data is stale.
      if (!isStale && series.breaches.length > 0) {
        await post(openedMessage(series, series.breaches, sha), options);
        events++;
      }
      continue;
    }

    if (options.mode === "edge" && !isStale) {
      if (opened.length > 0) {
        await post(openedMessage(series, opened, sha), options);
        events++;
      }
      if (closed.length > 0) {
        await post(recoveredMessage(series, closed), options);
        events++;
      }
    }
  }

  // Staleness is checked in every mode: a dead cron produces no commit, so the
  // push trigger never fires and only the scheduled run can catch it. It is a
  // property of the runner, not of a concurrency level, so it is reported once.
  for (const series of isPrimaryLevel ? staleSeries : []) {
    if (scope && !scope.has(series.provider)) continue;
    await post(
      staleMessage(
        series,
        healthy.filter((h) => h !== series.displayName)
      ),
      options
    );
    events++;
  }

  const summary = pending
    .map((p) => {
      const parts = [
        p.opened.length ? `opened=${p.opened.map((m) => m.metric).join(",")}` : null,
        p.closed.length ? `closed=${p.closed.join(",")}` : null,
      ].filter(Boolean);
      return `${p.series.provider}: ${parts.length ? parts.join(" ") : "no change"} (${p.series.status})`;
    })
    .join("\n");
  console.error(
    `[check-regressions] mode=${options.mode} c${concurrency}` +
      `${options.asOf ? ` as-of=${options.asOf}` : ""} events=${events}\n${summary}`
  );

  return events;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
