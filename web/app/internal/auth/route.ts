import { NextResponse, type NextRequest } from "next/server";
import {
  createSession,
  internalSecret,
  INTERNAL_SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  verifyLinkToken,
} from "@/lib/internal-auth";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * Swaps the console's short-lived link token for a session cookie and drops
 * the token from the URL. Anything else gets a plain 404.
 */
export async function GET(request: NextRequest) {
  const secret = internalSecret();
  const token = request.nextUrl.searchParams.get("t");
  const sub = secret && token ? verifyLinkToken(token, secret) : null;
  if (!secret || !sub) {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }
  const response = NextResponse.redirect(new URL("/internal", request.url), { status: 303, headers: NO_STORE });
  response.cookies.set(INTERNAL_SESSION_COOKIE, createSession(sub, secret), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/internal",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
  return response;
}
