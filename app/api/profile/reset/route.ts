/**
 * POST /api/profile/reset
 * Body: { mode: string, confirm?: string }
 *
 * Modes:
 *   "prefs"       — reset UserJobPreference to defaults; keep account, sources, jobs
 *   "onboarding"  — mark onboarding incomplete; redirect user to wizard on next page load
 *   "sources"     — remove all UserJobSource rows for this user (does not delete global JobSource)
 *   "jobs"        — clear UserJobStatus + UserJobRecommendation for this user
 *   "workspace"   — all of the above; requires confirm = "RESET"
 *
 * Returns: { ok: true, reset: string[] }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { tryGetSessionUserId } from "@/lib/get-user-id";

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
  const userId = await tryGetSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // ── Preferences ────────────────────────────────────────────────────────────
  if (mode === "prefs" || mode === "workspace") {
    await prisma.userJobPreference.upsert({
      where:  { userId },
      create: { userId, ...DEFAULT_PREFS },
      update: DEFAULT_PREFS,
    });

    // Also reset onboarding prefsJson so wizard defaults are fresh
    await prisma.userOnboarding.updateMany({
      where:  { userId },
      data:   { prefsJson: null },
    });

    reset.push("preferences");
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────
  if (mode === "onboarding" || mode === "workspace") {
    await prisma.userOnboarding.upsert({
      where:  { userId },
      create: { userId, onboardingCompleted: false, onboardingVersion: 1 },
      update: { onboardingCompleted: false, completedAt: null, prefsJson: null },
    });
    reset.push("onboarding");
  }

  // ── User sources ───────────────────────────────────────────────────────────
  if (mode === "sources" || mode === "workspace") {
    await prisma.userJobSource.deleteMany({ where: { userId } });
    reset.push("user_sources");
  }

  // ── User job state ─────────────────────────────────────────────────────────
  if (mode === "jobs" || mode === "workspace") {
    await prisma.userJobStatus.deleteMany({ where: { userId } });
    await prisma.userJobRecommendation.deleteMany({ where: { userId } });
    await prisma.userRecommendationRun.deleteMany({ where: { userId } });
    reset.push("job_statuses", "recommendations", "recommendation_runs");
  }

  // ── Workspace also resets role profiles ───────────────────────────────────
  if (mode === "workspace") {
    await prisma.userRoleProfile.deleteMany({ where: { userId } });
    reset.push("role_profiles");
  }

  return NextResponse.json({ ok: true, mode, reset });
}
