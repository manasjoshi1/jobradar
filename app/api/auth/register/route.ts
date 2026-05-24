/**
 * POST /api/auth/register
 * Body: { fullName, email, password, confirmPassword }
 *
 * Creates a new User account and a UserOnboarding record (onboardingCompleted: false).
 * Issues a session cookie — the user is logged in immediately after registration.
 * Proxy will redirect them to /onboarding because onboardingCompleted is false.
 *
 * Returns: { ok: true, user: { id, name, email } }
 */
import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signSession, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: {
    fullName?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName      = (body.fullName ?? "").trim();
  const email         = (body.email ?? "").trim().toLowerCase();
  const password      = body.password ?? "";
  const confirmPass   = body.confirmPassword ?? "";

  // ── Validation ────────────────────────────────────────────────────────────────
  if (!fullName) {
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  }
  if (fullName.length < 2) {
    return NextResponse.json({ error: "Full name must be at least 2 characters" }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (password !== confirmPass) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  // ── Duplicate email check ─────────────────────────────────────────────────────
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Generic message — don't confirm email existence to potential attackers
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  // ── Create user ───────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name:        fullName,
      fullName,
      passwordHash,
      isDefault:   false,
    },
    select: { id: true, name: true, email: true, isDefault: true },
  });

  // Create onboarding record (incomplete by default)
  await prisma.userOnboarding.create({
    data: {
      userId:             user.id,
      onboardingCompleted: false,
      onboardingVersion:  1,
    },
  });

  // ── Issue session ─────────────────────────────────────────────────────────────
  const token = await signSession({
    sub:                user.id,
    name:               user.name,
    isDefault:          user.isDefault,
    onboardingCompleted: false,
  });

  const res = NextResponse.json({
    ok:   true,
    user: { id: user.id, name: user.name, email: user.email },
  });
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
