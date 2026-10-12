import { NextRequest, NextResponse } from "next/server";
import { captureApiRequest } from "@/lib/posthog-server";

const VALID_PERCENTILES = ["median", "p90", "p95", "p99"];

/**
 * Backwards-compatible redirect: /api/leaderboard?percentile=p90
 * now 307s to /api/leaderboard/p90.
 *
 * The percentile is encoded in the path so each variant has a distinct URL,
 * eliminating cache-key collisions on CDNs that strip query strings.
 */
export async function GET(request: NextRequest) {
  captureApiRequest(request, "/api/leaderboard");
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("percentile") || "median";

  if (!VALID_PERCENTILES.includes(raw)) {
    return Response.json(
      { error: `Invalid percentile. Must be one of: ${VALID_PERCENTILES.join(", ")}` },
      { status: 400 }
    );
  }

  const url = new URL(`/api/leaderboard/${raw}`, request.url);
  return NextResponse.redirect(url, 307);
}
