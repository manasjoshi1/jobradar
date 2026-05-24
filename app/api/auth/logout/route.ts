/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name:     COOKIE_NAME,
    value:    "",
    httpOnly: true,
    maxAge:   0,
    path:     "/",
  });
  return res;
}
