import { loadLeaderboard } from "@/lib/data";
import { PROXY_COUNTRIES } from "../../../../src/benchmarks/proxy-get/schema";

export async function GET() {
  const result = await loadLeaderboard("hello-browser");

  return Response.json(
    {
      helloBrowser: {
        dateRange: result.metadata.dateRange,
      },
      proxyGet: { countries: PROXY_COUNTRIES, page: "/proxy-get" },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
