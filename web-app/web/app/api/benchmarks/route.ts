import { loadLeaderboard, listBenchmarkDates } from "@/lib/data";

export async function GET() {
  const v0Dates = await listBenchmarkDates("v0");
  const helloBrowserResult = await loadLeaderboard("hello-browser");

  return Response.json({
    helloBrowser: {
      dateRange: helloBrowserResult.metadata.dateRange,
    },
    v0: {
      dates: v0Dates,
    },
  });
}
