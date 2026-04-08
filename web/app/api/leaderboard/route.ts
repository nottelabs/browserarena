import { NextRequest } from "next/server";
import {
  loadLeaderboard,
  type PercentileType,
} from "@/lib/data";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const percentile = (searchParams.get("percentile") || "median") as PercentileType;

  const validPercentiles: PercentileType[] = ["median", "p90", "p95"];
  const effectivePercentile = validPercentiles.includes(percentile)
    ? percentile
    : "median";

  const result = await loadLeaderboard("hello-browser", undefined, effectivePercentile);
  return Response.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
