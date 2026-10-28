import { loadPublishedBrowserThroughput } from "@/lib/browser-throughput-data";
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

  const date = params.get("date") ?? undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid date. Use YYYY-MM-DD." }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }
  const { leaderboard, publication } = await loadPublishedBrowserThroughput(concurrency, date);
  return Response.json({
    ...leaderboard,
    metadata: { ...leaderboard.metadata, publication },
  }, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
