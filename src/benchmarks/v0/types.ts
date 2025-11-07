import type { ProviderName } from "../../types.js";
import type { HelloBrowserRecord } from "../hello-browser/types.js";

export type V0Record = HelloBrowserRecord & {
  concurrency: number;
  page_ttfb_ms: number | null;
  page_dom_content_loaded_ms: number | null;
  page_load_ms: number | null;
  cost_usd: number | null;
};
