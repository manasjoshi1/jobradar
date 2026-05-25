/**
 * POST /api/profile/reset
 * Body: { mode: string, confirm?: string }
 *
 * Modes:
 *   "prefs"       — reset UserJobPreference to defaults; keep account, sources, jobs
 *   "onboarding"  — set requiresReboarding=true so next load goes to wizard;
 *                   completedAt is preserved (not cleared — see design note below)
 *   "sources"     — remove all UserJobSource rows for this user (does not delete global JobSource)
 *   "jobs"        — clear UserJobStatus + UserJobRecommendation for this user
 *   "workspace"   — all of the above; requires confirm = "RESET"
 *
 * Design note — why we never clear completedAt:
 *   completedAt is an audit timestamp ("when did this user ever first complete onboarding").
 *   Clearing it would make the system believe the user is a brand-new user, which is wrong.
 *   Instead, requiresReboarding=true is the explicit flag that drives re-onboarding.
 *   Finishing the wizard sets requiresReboarding=false, so the cycle is clean.
 *
 * JWT refresh:
 *   When requiresReboarding is set, we issue a new JWT cookie immediately so the
 *   browser can redirect to /onboarding without waiting for logout/login.
 *
 * Returns: { ok: true, reset: string[] }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest, signSession, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_PREFS = {
  targetLocations:    JSON.stringify(["remote", "united states"]),
  targetRoles:        JSON.stringify([
    "Software Engineer", "Backend Developer", "Frontend Developer",
    "Full Stack Developer", "Java Developer", "Python Developer",
  ]),
  blockedCompanies:   JSON.stringify([]),
  preferredCompanies: JSON.stringify([]),
  minScore:           40,
  requiresSponsorship: true,
};

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.sub;

  let body: { mode?: string; confirm?: string };
  try {
    body = await request.json() as { mode?: string; confirm?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode    = (body.mode ?? "").trim();
  const confirm = (body.confirm ?? "").trim();

  const VALID_MODES = ["prefs", "onboarding", "sources", "jobs", "workspace"] as const;
  if (!VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
    return NextResponse.json(
      { error: `mode must be one of: ${VALID_MODES.join(", ")}` },
      { status: 400 },
    );
  }

  if (mode === "workspace" && confirm !== "RESET") {
    return NextResponse.json(
      { error: 'Full workspace reset requires confirm = "RESET"' },
      { status: 400 },
    );
  }

  const reset: string[] = [];

  // ── Preferences ─────────────────────────────────────────────────────────────
  if (mode === "prefs" || mode === "workspace") {
    await prisma.userJobPreference.upsert({
      where:  { userId },
      create: { userId, ...DEFAULT_PREFS },
      update: DEFAULT_PREFS,
    });

    // Clear wizard snapshot so defaults are fresh next time
    await prisma.userOnboarding.updateMany({
      where: { userId },
      data:  { prefsJson: null },
    });

    reset.push("preferences");
  }

  // ── Onboarding ───────────────────────────────────────────────────────────────
  // We set requiresReboarding=true (NOT clear completedAt).
  // completedAt is a permanent audit record of "this user has completed onboarding at least once".
  // Clearing it would incorrectly treat an experienced user as a brand-new user.
  if (mode === "onboarding" || mode === "workspace") {
    await prisma.userOnboarding.upsert({
      where:  { userId },
      create: {
        userId,
        onboardingCompleted: false,
        onboardingVersion:   1,
        requiresReboarding:  true,
        reboardingReason:    "Manual reset by user",
      },
      update: {
        requiresReboarding: true,
        reboardingReason:   "Manual reset by user",
        prefsJson:          null,
      },
    });
    reset.push("onboarding");
  }

  // ── User sources ─────────────────────────────────────────────────────────────
  if (mode === "sources" || mode === "workspace") {
    await prisma.userJobSource.deleteMany({ where: { userId } });
    reset.push("user_sources");
  }

  // ── User job state ───────────────────────────────────────────────────────────
  if (mode === "jobs" || mode === "workspace") {
    await prisma.userJobStatus.deleteMany({ where: { userId } });
    await prisma.userJobRecommendation.deleteMany({ where: { userId } });
    await prisma.userRecommendationRun.deleteMany({ where: { userId } });
    reset.push("job_statuses", "recommendations", "recommendation_runs");
  }

  // ── Workspace also resets role profiles ──────────────────────────────────────
  if (mode === "workspace") {
    await prisma.userRoleProfile.deleteMany({ where: { userId } });
    reset.push("role_profiles");
  }

  // ── Refresh JWT when re-onboarding is triggered ───────────────────────────────
  // Issue a new cookie immediately so the browser redirect to /onboarding works
  // without requiring the user to log out and back in.
  const needsReboardingJwt = mode === "onboarding" || mode === "workspace";
  const user = needsReboardingJwt
    ? await prisma.user.findUnique({
        where:  { id: userId },
        select: { id: true, name: true, isDefault: true },
      })
    : null;

  const res = NextResponse.json({ ok: true, mode, reset });

  if (needsReboardingJwt && user) {
    const token = await signSession({
      sub:                 user.id,
      name:                user.name,
      isDefault:           user.isDefault,
      onboardingCompleted: false,   // triggers proxy → /onboarding
    });
    res.cookies.set(sessionCookieOptions(token));
  }

  return res;
}
