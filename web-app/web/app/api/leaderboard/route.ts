import { NextRequest } from "next/server";
import {
  loadLeaderboard,
  type PercentileType,
} from "@/lib/data";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const benchmark = (searchParams.get("benchmark") || "hello-browser") as
    | "hello-browser"
    | "v0";
  const date = searchParams.get("date") || undefined;
  const percentile = (searchParams.get("percentile") || "median") as PercentileType;

  const validPercentiles: PercentileType[] = ["median", "p90", "p95"];
  const effectivePercentile = validPercentiles.includes(percentile)
    ? percentile
    : "median";

  const result = await loadLeaderboard(benchmark, date, effectivePercentile);
  return Response.json(result);
}
