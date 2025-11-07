import type { ProviderName } from "../../types.js";

export type HelloBrowserRecord = {
  created_at: string;
  id: string | null;
  session_creation_ms: number | null;
  session_connect_ms: number | null;
  page_goto_ms: number | null;
  session_release_ms: number | null;
  provider: ProviderName;
  success: boolean;
  error_stage: string | null;
  error_message: string | null;
};
