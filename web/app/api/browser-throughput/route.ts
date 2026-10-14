import { loadBrowserThroughputLeaderboard } from "@/lib/browser-throughput-data";
import { captureApiRequest } from "@/lib/posthog-server";

/**
 * GET /api/browser-throughput?concurrency=1
 *
 * The browser-throughput leaderboard: per provider, strict success rate, action
 * completion, actions per second, per-action percentiles, drift and cost per
 * 1,000 actions. Same shape the /throughput page renders.
 */
export async function GET(request: Request) {
  captureApiRequest(request, "/api/browser-throughput");
  const params = new URL(request.url).searchParams;
  const raw = params.get("concurrency") ?? "1";
  const concurrency = Number(raw);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return Response.json(
      { error: `Invalid concurrency: ${raw}. Must be a positive integer.` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const result = await loadBrowserThroughputLeaderboard(concurrency);
  return Response.json(result, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
