import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createLinkToken,
  createSession,
  internalSecret,
  INTERNAL_SECRET_ENV,
  verifyLinkToken,
  verifySession,
} from "./internal-auth";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000;

/** The console's side of the contract, written out independently. */
function consoleToken(claims: object, secret = SECRET): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");
  return `v1.${payload}.${sig}`;
}

test("accepts a fresh link token minted the way the console mints it", () => {
  const token = consoleToken({ aud: "browserarena-internal", sub: "dev@notte.cc", iat: NOW, exp: NOW + 300 });
  assert.equal(verifyLinkToken(token, SECRET, NOW), "dev@notte.cc");
  assert.equal(createLinkToken("dev@notte.cc", SECRET, NOW), token);
});

test("rejects expired, long-lived, future, tampered, and wrongly signed links", () => {
  const claims = { aud: "browserarena-internal", sub: "dev@notte.cc", iat: NOW, exp: NOW + 300 };
  assert.equal(verifyLinkToken(consoleToken(claims), SECRET, NOW + 300), null);
  assert.equal(verifyLinkToken(consoleToken({ ...claims, exp: NOW + 24 * 3600 }), SECRET, NOW), null);
  assert.equal(verifyLinkToken(consoleToken({ ...claims, iat: NOW + 3600 }), SECRET, NOW), null);
  assert.equal(verifyLinkToken(consoleToken(claims, "x".repeat(40)), SECRET, NOW), null);
  const [v, , sig] = consoleToken(claims).split(".");
  const forged = Buffer.from(JSON.stringify({ ...claims, sub: "other@notte.cc" })).toString("base64url");
  assert.equal(verifyLinkToken(`${v}.${forged}.${sig}`, SECRET, NOW), null);
  for (const bad of ["", "v1", "v1..", "v2.a.b", "v1.e30.AAAA", "not-a-token"]) {
    assert.equal(verifyLinkToken(bad, SECRET, NOW), null, bad);
  }
});

test("a link token is not a session and a session is not a link", () => {
  const link = createLinkToken("dev@notte.cc", SECRET, NOW);
  const session = createSession("dev@notte.cc", SECRET, NOW);
  assert.equal(verifySession(link, SECRET, NOW), null);
  assert.equal(verifyLinkToken(session, SECRET, NOW), null);
});

test("sessions last twelve hours", () => {
  const session = createSession("dev@notte.cc", SECRET, NOW);
  assert.equal(verifySession(session, SECRET, NOW + 12 * 3600 - 1), "dev@notte.cc");
  assert.equal(verifySession(session, SECRET, NOW + 12 * 3600), null);
  assert.equal(verifySession(undefined, SECRET, NOW), null);
  assert.equal(verifySession(session, "y".repeat(40), NOW), null);
});

test("the page is off without a secret of at least 32 characters", () => {
  const saved = process.env[INTERNAL_SECRET_ENV];
  try {
    delete process.env[INTERNAL_SECRET_ENV];
    assert.equal(internalSecret(), null);
    process.env[INTERNAL_SECRET_ENV] = "short";
    assert.equal(internalSecret(), null);
    process.env[INTERNAL_SECRET_ENV] = SECRET;
    assert.equal(internalSecret(), SECRET);
  } finally {
    if (saved === undefined) delete process.env[INTERNAL_SECRET_ENV];
    else process.env[INTERNAL_SECRET_ENV] = saved;
  }
});
