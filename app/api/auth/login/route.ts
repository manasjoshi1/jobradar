/**
 * POST /api/auth/login
 * Body: { email?: string, password: string }
 *
 * Supports two login modes:
 *   1. email + password  — matches User by email
 *   2. password only     — matches the single default user (single-tenant mode)
 *
 * Returns: { ok: true, user: { id, name, email, isDefault } }
 * Sets:    jobradar_session httpOnly cookie (7 days)
 */
import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signSession, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json() as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const password = (body.password ?? "").trim();
  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  // Find user — by email if provided, else by isDefault
  let user: { id: string; name: string | null; email: string | null; passwordHash: string | null; isDefault: boolean } | null = null;

  if (body.email?.trim()) {
    user = await prisma.user.findUnique({
      where: { email: body.email.trim() },
      select: { id: true, name: true, email: true, passwordHash: true, isDefault: true },
    });
  } else {
    user = await prisma.user.findFirst({
      where: { isDefault: true },
      select: { id: true, name: true, email: true, passwordHash: true, isDefault: true },
    });
  }

  if (!user) {
    // Generic message — don't reveal whether user exists
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "No password set for this account. Run: npm run auth:set-password" },
      { status: 401 },
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signSession({
    sub:       user.id,
    name:      user.name,
    isDefault: user.isDefault,
  });

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, isDefault: user.isDefault },
  });
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
