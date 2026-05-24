/**
 * POST /api/onboarding
 * Body: { data: OnboardingData }
 *
 * Saves onboarding preferences for the authenticated user:
 *   1. Updates user.name + user.fullName
 *   2. Deletes existing UserRoleProfiles and creates one unified profile
 *   3. Upserts UserJobPreference
 *   4. Marks UserOnboarding as complete
 *   5. Issues a new session JWT with onboardingCompleted: true
 *
 * Returns: { ok: true }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest, signSession, sessionCookieOptions } from "@/lib/auth";
import { buildLocationPrefs } from "@/lib/onboarding-presets";
import type { OnboardingData } from "@/app/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { data: OnboardingData };
  try {
    body = await request.json() as { data: OnboardingData };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = body.data;
  if (!data) {
    return NextResponse.json({ error: "Missing data field" }, { status: 400 });
  }

  const userId = session.sub;

  // ── 1. Update user name ───────────────────────────────────────────────────────
  const fullName = (data.fullName ?? "").trim() || null;
  await prisma.user.update({
    where: { id: userId },
    data: {
      fullName,
      name: fullName,
    },
  });

  // ── 2. Build merged title + keyword lists ─────────────────────────────────────
  const allTitles = [
    ...(data.selectedTitles ?? []),
    ...(data.hiddenTitles ?? []),
    ...(data.customTitles ?? []),
  ].map((t) => t.trim()).filter(Boolean);

  // If nothing was selected, fall back to sensible defaults
  const preferredTitles = allTitles.length > 0
    ? allTitles
    : ["Software Engineer", "Backend Engineer"];

  const mustHaveKeywords  = (data.selectedSkills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const niceHaveKeywords  = (data.niceHaveKeywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const negativeKeywords  = (data.negativeKeywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const minScore          = Math.max(10, Math.min(90, Number(data.minScore) || 40));
  const locationPrefs     = buildLocationPrefs({
    remoteOk:    data.remoteOk ?? true,
    hybridOk:    data.hybridOk ?? true,
    onsiteOk:    data.onsiteOk ?? true,
    targetCities: data.targetCities ?? [],
  });

  // ── 3. Delete existing role profiles + create one unified profile ─────────────
  await prisma.userRoleProfile.deleteMany({ where: { userId } });

  await prisma.userRoleProfile.create({
    data: {
      userId,
      name:               "My Job Search Profile",
      enabled:            true,
      priority:           10,
      preferredTitles:    JSON.stringify(preferredTitles),
      preferredLocations: JSON.stringify(locationPrefs),
      mustHaveKeywords:   JSON.stringify(mustHaveKeywords),
      niceHaveKeywords:   JSON.stringify(niceHaveKeywords),
      negativeKeywords:   JSON.stringify(negativeKeywords),
      requiresSponsorship: data.needsSponsorship ?? true,
      minScore,
    },
  });

  // ── 4. Upsert UserJobPreference ───────────────────────────────────────────────
  // Collect target roles from selected titles
  const targetRoles = preferredTitles.slice(0, 30); // cap for DB sanity

  await prisma.userJobPreference.upsert({
    where:  { userId },
    create: {
      userId,
      targetLocations:    JSON.stringify(locationPrefs),
      targetRoles:        JSON.stringify([...new Set(targetRoles)]),
      blockedCompanies:   JSON.stringify(data.blockedCompanies ?? []),
      preferredCompanies: JSON.stringify([]),
      minScore,
      requiresSponsorship: data.needsSponsorship ?? true,
    },
    update: {
      targetLocations:    JSON.stringify(locationPrefs),
      targetRoles:        JSON.stringify([...new Set(targetRoles)]),
      blockedCompanies:   JSON.stringify(data.blockedCompanies ?? []),
      minScore,
      requiresSponsorship: data.needsSponsorship ?? true,
    },
  });

  // ── 5. Mark onboarding complete + store full prefs snapshot ──────────────────
  await prisma.userOnboarding.upsert({
    where:  { userId },
    create: {
      userId,
      onboardingCompleted: true,
      onboardingVersion:   1,
      prefsJson:           JSON.stringify(data),
      completedAt:         new Date(),
    },
    update: {
      onboardingCompleted: true,
      prefsJson:           JSON.stringify(data),
      completedAt:         new Date(),
    },
  });

  // ── 6. Issue updated JWT with onboardingCompleted: true ───────────────────────
  const updatedUser = await prisma.user.findUniqueOrThrow({
    where:  { id: userId },
    select: { id: true, name: true, isDefault: true },
  });

  const token = await signSession({
    sub:                 updatedUser.id,
    name:                updatedUser.name,
    isDefault:           updatedUser.isDefault,
    onboardingCompleted: true,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
