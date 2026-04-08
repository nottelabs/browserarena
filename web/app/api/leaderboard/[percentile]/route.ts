import {
  loadLeaderboard,
  type PercentileType,
} from "@/lib/data";

const VALID_PERCENTILES: PercentileType[] = ["median", "p90", "p95"];

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ percentile: string }> }
) {
  const { percentile } = await params;

  if (!VALID_PERCENTILES.includes(percentile as PercentileType)) {
    return Response.json(
      { error: `Invalid percentile. Must be one of: ${VALID_PERCENTILES.join(", ")}` },
      { status: 400 }
    );
  }

  const result = await loadLeaderboard(
    "hello-browser",
    undefined,
    percentile as PercentileType
  );
  return Response.json(result, { headers: CACHE_HEADERS });
}
