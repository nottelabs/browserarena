import fs from "node:fs/promises";
import path from "node:path";
import { getResultsDir } from "./data";
import { CAMPAIGN_ID, validateCampaign } from "../../src/benchmarks/captcha/publication";

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
