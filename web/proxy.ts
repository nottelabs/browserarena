import { NextResponse, type NextRequest } from "next/server";
import { internalSecret, INTERNAL_SESSION_COOKIE, verifySession } from "@/lib/internal-auth";

/**
 * The team-only page answers 404 to anyone without a session, before any
 * rendering. The page checks the session again. `/internal/auth` is a route
 * handler that verifies its own token, so it is not matched here.
 */
export function proxy(request: NextRequest) {
  const secret = internalSecret();
  if (secret && verifySession(request.cookies.get(INTERNAL_SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/internal"] };
