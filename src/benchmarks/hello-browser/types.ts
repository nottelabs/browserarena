import type { ProviderName } from "../../types.js";

export type HelloBrowserRecord = {
  created_at: string;
  id: string | null;
  session_creation_ms: number | null;
  session_connect_ms: number | null;
  page_goto_ms: number | null;
  session_release_ms: number | null;
  provider: ProviderName;
  concurrency: number;
  success: boolean;
  error_stage: string | null;
  error_message: string | null;
  /** Path to a PNG captured when the failure happened with an open browser/page (repo-relative when possible). */
  error_screenshot_path: string | null;
};
