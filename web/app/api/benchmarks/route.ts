import { loadLeaderboard } from "@/lib/data";

export async function GET() {
  const result = await loadLeaderboard("hello-browser");

  return Response.json(
    {
      helloBrowser: {
        dateRange: result.metadata.dateRange,
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
