import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Access to the team-only `/internal` page.
 *
 * The Notte console mints a link token for a signed-in superadmin and redirects
 * to `/internal/auth?t=<token>`. That route swaps it for a session cookie, so
 * the token never stays in the address bar, history, or analytics. Both are
 * `v1.<base64url JSON>.<base64url HMAC-SHA256 of "v1.<payload>">`, signed with
 * BROWSERARENA_INTERNAL_LINK_SECRET. The `aud` field keeps a link token from
 * being used as a session and the reverse.
 */

export const INTERNAL_SECRET_ENV = "BROWSERARENA_INTERNAL_LINK_SECRET";
export const INTERNAL_SESSION_COOKIE = "ba_internal";

const LINK_AUDIENCE = "browserarena-internal";
const SESSION_AUDIENCE = "browserarena-internal-session";
/** Upper bound on a link's remaining life, whatever `exp` the console sets. */
export const MAX_LINK_LIFETIME_SECONDS = 10 * 60;
export const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

interface Claims {
  aud: string;
  sub: string;
  iat?: number;
  exp: number;
}

function sign(secret: string, signedPart: string): Buffer {
  return createHmac("sha256", secret).update(signedPart).digest();
}

function encode(claims: Claims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `v1.${payload}.${sign(secret, `v1.${payload}`).toString("base64url")}`;
}

function decode(token: string, secret: string, audience: string, now: number): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
  const expected = sign(secret, `v1.${parts[1]}`);
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let claims: Partial<Claims>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.aud !== audience || typeof claims.sub !== "string" || !claims.sub) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (claims.iat !== undefined && (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS)) return null;
  return claims as Claims;
}

/** The signed-in user's email when the console's link is genuine and fresh. */
export function verifyLinkToken(token: string, secret: string, now = nowSeconds()): string | null {
  const claims = decode(token, secret, LINK_AUDIENCE, now);
  if (!claims || claims.exp - now > MAX_LINK_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS) return null;
  return claims.sub;
}

export function createSession(sub: string, secret: string, now = nowSeconds()): string {
  return encode({ aud: SESSION_AUDIENCE, sub, iat: now, exp: now + SESSION_LIFETIME_SECONDS }, secret);
}

export function verifySession(cookie: string | undefined, secret: string, now = nowSeconds()): string | null {
  if (!cookie) return null;
  const claims = decode(cookie, secret, SESSION_AUDIENCE, now);
  if (!claims || claims.exp - now > SESSION_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS) return null;
  return claims.sub;
}

/** A link token as the console mints it. Used by tests and local checks. */
export function createLinkToken(sub: string, secret: string, now = nowSeconds(), lifetime = 300): string {
  return encode({ aud: LINK_AUDIENCE, sub, iat: now, exp: now + lifetime }, secret);
}

/** The configured secret, or null when the page is switched off. */
export function internalSecret(): string | null {
  const secret = process.env[INTERNAL_SECRET_ENV];
  // A short secret is a misconfiguration; treat it as off rather than weak.
  return secret && secret.length >= 32 ? secret : null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
