import { loadCaptchaCampaigns } from "@/lib/captcha-data";
import { CAMPAIGN_ID } from "../../../../src/benchmarks/captcha/publication";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("campaign");
  if (id !== null && !CAMPAIGN_ID.test(id)) return Response.json({ error: "Invalid campaign ID" }, { status: 400 });
  const campaigns = await loadCaptchaCampaigns();
  if (id !== null) {
    const campaign = campaigns.find(item => item.id === id);
    return campaign ? Response.json(campaign) : Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  return Response.json({ benchmark: "captcha", campaigns });
}
