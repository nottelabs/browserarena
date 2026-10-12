import posthog from "posthog-js";

/**
 * The site's analytics contract. Event names are past-tense snake_case and
 * every event carries the benchmark it happened on. Pageviews, link clicks
 * and exceptions are captured automatically; these are the interactions that
 * autocapture cannot name.
 */
export type Benchmark = "session-performance" | "browser-throughput" | "proxy-performance";

type Events = {
  leaderboard_sorted: { benchmark: Benchmark; column: string; direction: "asc" | "desc" };
  percentile_selected: { benchmark: Benchmark; percentile: string };
  value_score_preset_selected: { benchmark: Benchmark; preset: string };
  breakdown_toggled: { benchmark: Benchmark; expanded: boolean };
  history_range_selected: { benchmark: Benchmark; range: string };
  history_metric_selected: { benchmark: Benchmark; metric: string };
  history_provider_selected: { benchmark: Benchmark; provider: string };
  run_day_selected: { benchmark: Benchmark; date: string };
  raw_samples_toggled: { benchmark: Benchmark; shown: boolean };
};

/** No-op until PostHog has initialized (missing token, blocked script, server render). */
export function track<E extends keyof Events>(event: E, properties: Events[E]): void {
  if (typeof window === "undefined" || !posthog.__loaded) return;
  posthog.capture(event, properties);
}

export { withNotteUtm } from "./utm";
