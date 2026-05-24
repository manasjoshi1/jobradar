/**
 * Auth utilities — JWT session via httpOnly cookie.
 *
 * SESSION_SECRET env var (min 32 chars) signs the JWT.
 * Falls back to a deterministic dev secret so local dev works without .env.
 *
 * Cookie: jobradar_session  (httpOnly, SameSite=Lax, Secure in prod)
 * JWT payload: { sub: userId, name, isDefault }
 * Expiry: 7 days (sliding on each page load if desired)
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// ── Constants ─────────────────────────────────────────────────────────────────

export const COOKIE_NAME = "jobradar_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET ?? "jobradar-dev-secret-change-in-production-32c";
  return new TextEncoder().encode(raw.padEnd(32, "!").slice(0, 64));
}

// ── Payload shape ─────────────────────────────────────────────────────────────

export type SessionPayload = JWTPayload & {
  sub: string;        // userId
  name: string | null;
  isDefault: boolean;
  /** Undefined on legacy sessions — treat as true (already-onboarded users). */
  onboardingCompleted?: boolean;
};

// ── Sign / Verify ─────────────────────────────────────────────────────────────

export async function signSession(payload: Omit<SessionPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers (Server Components / Route Handlers) ───────────────────────

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function sessionCookieOptions(token: string) {
  // Only set Secure flag when explicitly opted in (i.e. you have TLS).
  // NODE_ENV=production on plain HTTP (port 80) causes browsers to silently
  // drop the cookie on every subsequent request, breaking post-login redirects.
  const secure = process.env.COOKIE_SECURE === "true";
  return {
    name:     COOKIE_NAME,
    value:    token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    maxAge:   SESSION_DURATION_SECONDS,
    path:     "/",
  };
}

// ── Middleware helper ─────────────────────────────────────────────────────────

/** Reads the session token from a middleware request (no next/headers). */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Build a redirect response that clears the session cookie. */
export function redirectToLogin(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete(COOKIE_NAME);
  return res;
}
