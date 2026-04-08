import { NextRequest, NextResponse } from "next/server";

/**
 * Backwards-compatible redirect: /api/leaderboard?percentile=p90
 * now 301s to /api/leaderboard/p90.
 *
 * The percentile is encoded in the path so each variant has a distinct URL,
 * eliminating cache-key collisions on CDNs that strip query strings.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const percentile = searchParams.get("percentile") || "median";

  const url = new URL(`/api/leaderboard/${percentile}`, request.url);
  return NextResponse.redirect(url, 301);
}
