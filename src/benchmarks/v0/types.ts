import type { ProviderName } from "../../types.js";

export type V0Record = {
  created_at: string;
  id: string | null;
  provider: ProviderName;
  concurrency: number;
  success: boolean;
  error_stage: string | null;
  error_message: string | null;
  error_screenshot_path: string | null;

  // Infra timings
  session_creation_ms: number | null;
  session_connect_ms: number | null;
  session_release_ms: number | null;

  // Phase timings
  extract_ms: number | null;
  crawl_ms: number | null;
  form_ms: number | null;
  total_work_ms: number | null;

  // Extracted data summary
  seed_title: string | null;
  seed_word_count: number | null;
  pages_visited: number | null;
  pages_extracted: number | null;
  total_words_extracted: number | null;
  total_images_found: number | null;
  crawled_titles: string[] | null;

  cost_usd: number | null;
};
