import fs from "node:fs/promises";
import path from "node:path";
import { getResultsDir } from "./data";
import { CAMPAIGN_ID, validateCampaign, type CaptchaCell, type CaptchaType, type PublicCampaign } from "../../src/benchmarks/captcha/publication";
import { PROVIDERS } from "../../src/benchmarks/captcha/protocol.mjs";

/** Providers the runner benchmarks today; newer ones may be missing from older runs. */
export const CAPTCHA_PROVIDERS: readonly string[] = PROVIDERS;

/** Notes for benchmarked providers missing from the selected run. */
export function captchaProviderNotes(selected: { providers: string[] }, campaigns: { providers: string[] }[]): Record<string, string> {
  return Object.fromEntries(CAPTCHA_PROVIDERS.filter(provider => !selected.providers.includes(provider)).map(provider =>
    [provider, campaigns.some(campaign => campaign.providers.includes(provider))
      ? "Not in this run: it was added to the benchmark after this run, or left out of it"
      : "No results yet: added to the benchmark after the latest published run"]));
}

export type { CaptchaCell, CaptchaType, PublicCampaign };

// Columns come from each campaign's protocol: v3 shows three types, v4 seven.
// `signal_label` is "Server acceptance", "Token delivery only", "Page check" or "Page reached".
export function captchaColumns(campaign: PublicCampaign): CaptchaType[] {
  return campaign.types;
}

// The count, success word and median that belong to a column's own success signal.
export const SUCCESS_WORDS: Record<CaptchaType["signal"], string> = {
  server_acceptance: "accepted", token_delivery: "delivered", page_check: "passed", page_reached: "reached",
};
export function cellSuccess(cell: CaptchaCell) {
  return { count: cell.succeeded, word: SUCCESS_WORDS[cell.signal], median_ms: cell.success_median_ms, interval_95: cell.success_interval_95 };
}

// Benchmarked elsewhere on the site but never run here: these providers have no
// native CAPTCHA solving (sources in docs/captcha.md). Keys are CAPTCHA provider IDs.
export const CAPTCHA_UNSUPPORTED_PROVIDERS: Readonly<Record<string, string>> = {
  tinyfish: "TinyFish has no CAPTCHA solving; its docs call CAPTCHAs a hard limit",
  "aws-agentcore": "AgentCore Browser has no CAPTCHA solving; Web Bot Auth only reduces CAPTCHAs on sites that accept verified bots",
  cloudflare: "Cloudflare Browser Run has no CAPTCHA solving; it hands CAPTCHAs to a person through Live View",
  lightpanda: "Lightpanda has no CAPTCHA solving",
};

// Results ship with the reviewed revision, including on PR previews. Never read
// main's results as a fallback for an empty or incomplete preview campaign.
// next.config.ts explicitly traces results/captcha/*.json for both consumers.
export async function loadCaptchaCampaigns(directory = path.join(getResultsDir(), "captcha")) {
  let names: string[];
  try { names = await fs.readdir(/* turbopackIgnore: true */ directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const campaigns = await Promise.all(names.filter(name => name.endsWith(".json")).map(async name => {
    const id = name.slice(0, -5);
    if (!CAMPAIGN_ID.test(id)) throw new Error("Invalid CAPTCHA results filename");
    const campaign = validateCampaign(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ path.join(directory, name), "utf8")));
    if (campaign.id !== id) throw new Error("CAPTCHA campaign filename and ID disagree");
    return campaign;
  }));
  return campaigns.sort((a, b) => b.started_at.localeCompare(a.started_at) || a.id.localeCompare(b.id));
}

export type CaptchaSuccessSignal = "acceptance" | "delivery";
export type CaptchaTypeInfo = {
  /** Fixture type as written in campaign attempts (`attempt.type`). */
  id: string;
  /** Column title on /captcha. */
  label: string;
  /** What counts as a success for this type. */
  signal: CaptchaSuccessSignal;
  /** Short label for that signal, shown in the column tooltip. */
  signalLabel: string;
};

/** Column order and labels on /captcha. Columns come from the selected campaign; types missing here fall back to their ID. */
export const CAPTCHA_TYPES: CaptchaTypeInfo[] = [
  { id: "turnstile", label: "Cloudflare Turnstile", signal: "acceptance", signalLabel: "Server acceptance" },
  { id: "recaptcha", label: "reCAPTCHA v2", signal: "acceptance", signalLabel: "Server acceptance" },
  { id: "hcaptcha", label: "hCaptcha", signal: "delivery", signalLabel: "Token delivery only" },
];
