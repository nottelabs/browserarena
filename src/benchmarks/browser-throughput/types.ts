import type { ProviderName } from "../../types.js";

/**
 * The six action types an agent issues on nearly every turn. Together they
 * cover the surface area of agent work inside a running session: a full
 * navigation, DOM polling, pixel capture, a DOM read, synthetic input, and
 * history navigation.
 */
export type AgentActionType =
  | "navigate"
  | "waitForSelector"
  | "screenshot"
  | "textContent"
  | "click"
  | "goBack";

export const AGENT_ACTION_TYPES: AgentActionType[] = [
  "navigate",
  "waitForSelector",
  "screenshot",
  "textContent",
  "click",
  "goBack",
];

export type AgentActionRecord = {
  /** 1-based position within the session. */
  index: number;
  /** 1-based loop the action belongs to. */
  loop: number;
  type: AgentActionType;
  duration_ms: number;
  success: boolean;
  /** Set when the action failed or was skipped. */
  error_message: string | null;
  /** True when the action was not attempted because earlier ones kept failing. */
  skipped: boolean;
};

export type BrowserThroughputRecord = {
  created_at: string;
  id: string | null;
  provider: ProviderName;
  concurrency: number;
  /** Warm-up sessions are written too, flagged so the leaderboard can skip them. */
  warmup: boolean;
  /** The first session of a run: the only one we can call cold with a straight face. */
  cold_start: boolean;
  /** True only when the session ran end to end and every action succeeded. */
  success: boolean;
  error_stage: string | null;
  error_message: string | null;

  session_creation_ms: number | null;
  session_connect_ms: number | null;
  session_release_ms: number | null;

  viewport_width: number;
  viewport_height: number;
  /** "dom" for browsers without layout, where a mouse click cannot target anything. */
  click_mode: "mouse" | "dom";

  loops: number;
  actions_total: number;
  actions_completed: number;
  /** Sum of every action's duration, so per-action numbers add up to this. */
  task_ms: number | null;
  /** actions_completed / (task_ms / 1000). */
  actions_per_second: number | null;
  /** Sum of action durations in the first and last loop, for within-session drift. */
  first_loop_ms: number | null;
  last_loop_ms: number | null;

  actions: AgentActionRecord[];
  /** The article each loop started from. */
  article_urls: string[];
  cost_usd: number | null;
};
