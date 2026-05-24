/**
 * POST /api/onboarding
 * Body: { data: OnboardingData }
 *
 * Saves onboarding preferences for the authenticated user:
 *   1. Updates user.name + user.fullName
 *   2. Upserts UserJobPreference
 *   3. Creates UserRoleProfile rows (one per selected preset + custom)
 *   4. Marks UserOnboarding as complete
 *   5. Issues a new session JWT with onboardingCompleted: true
 *
 * Returns: { ok: true }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest, signSession, sessionCookieOptions } from "@/lib/auth";
import { ROLE_PRESETS, buildLocationPrefs } from "@/lib/onboarding-presets";

export const dynamic = "force-dynamic";

export interface OnboardingData {
  fullName: string;
  jobGoalLevels: string[];
  employmentTypes: string[];
  selectedPresets: string[];
  customTitles: string[];
  remoteOk: boolean;
  hybridOk: boolean;
  onsiteOk: boolean;
  targetCities: string[];
  needsSponsorship: boolean;
  mustHaveKeywords: string[];
  niceHaveKeywords: string[];
  negativeKeywords: string[];
  minScore: number;
  blockedCompanies: string[];
}

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
      name: fullName,  // keep name in sync so it shows in the header
    },
  });

  // ── 2. Build location preferences ────────────────────────────────────────────
  const locationPrefs = buildLocationPrefs({
    remoteOk: data.remoteOk,
    hybridOk: data.hybridOk,
    onsiteOk: data.onsiteOk,
    targetCities: data.targetCities,
  });

  // ── 3. Delete existing role profiles and recreate from scratch ───────────────
  await prisma.userRoleProfile.deleteMany({ where: { userId } });

  const selectedPresets = (data.selectedPresets ?? []).filter(Boolean);
  const customTitles    = (data.customTitles ?? []).map((t) => t.trim()).filter(Boolean);
  const extraMustHave   = (data.mustHaveKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  const extraNiceHave   = (data.niceHaveKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  const negativeKws     = (data.negativeKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  const minScore        = Math.max(10, Math.min(90, Number(data.minScore) || 45));

  if (selectedPresets.length > 0) {
    let priority = 10 + selectedPresets.length;
    for (const presetId of selectedPresets) {
      const preset = ROLE_PRESETS.find((p) => p.id === presetId);
      if (!preset) continue;

      const allTitles   = [...new Set([...preset.titles, ...customTitles])];
      const allMust     = [...new Set([...preset.mustHave, ...extraMustHave])];
      const allNice     = [...new Set([...preset.niceHave, ...extraNiceHave])];
      const allNegative = [...new Set([...preset.negative, ...negativeKws])];

      await prisma.userRoleProfile.create({
        data: {
          userId,
          name:               preset.label,
          enabled:            true,
          priority:           priority--,
          preferredTitles:    JSON.stringify(allTitles),
          preferredLocations: JSON.stringify(locationPrefs),
          mustHaveKeywords:   JSON.stringify(allMust),
          niceHaveKeywords:   JSON.stringify(allNice),
          negativeKeywords:   JSON.stringify(allNegative),
          requiresSponsorship: data.needsSponsorship,
          minScore,
        },
      });
    }
  } else {
    // No presets — create a single "Custom" profile using whatever keywords provided
    const titles = customTitles.length > 0
      ? customTitles
      : ["Software Engineer", "Backend Engineer"];

    await prisma.userRoleProfile.create({
      data: {
        userId,
        name:               "Custom Profile",
        enabled:            true,
        priority:           10,
        preferredTitles:    JSON.stringify(titles),
        preferredLocations: JSON.stringify(locationPrefs),
        mustHaveKeywords:   JSON.stringify(extraMustHave),
        niceHaveKeywords:   JSON.stringify(extraNiceHave),
        negativeKeywords:   JSON.stringify(negativeKws),
        requiresSponsorship: data.needsSponsorship,
        minScore,
      },
    });
  }

  // ── 4. Upsert UserJobPreference ───────────────────────────────────────────────
  const targetRoles = selectedPresets.length > 0
    ? selectedPresets.flatMap((presetId) => {
        const preset = ROLE_PRESETS.find((p) => p.id === presetId);
        return preset ? preset.titles : [];
      })
    : customTitles;

  await prisma.userJobPreference.upsert({
    where: { userId },
    create: {
      userId,
      targetLocations:    JSON.stringify(locationPrefs),
      targetRoles:        JSON.stringify([...new Set(targetRoles)]),
      blockedCompanies:   JSON.stringify(data.blockedCompanies ?? []),
      preferredCompanies: JSON.stringify([]),
      minScore,
      requiresSponsorship: data.needsSponsorship,
    },
    update: {
      targetLocations:    JSON.stringify(locationPrefs),
      targetRoles:        JSON.stringify([...new Set(targetRoles)]),
      blockedCompanies:   JSON.stringify(data.blockedCompanies ?? []),
      minScore,
      requiresSponsorship: data.needsSponsorship,
    },
  });

  // ── 5. Mark onboarding complete ───────────────────────────────────────────────
  await prisma.userOnboarding.upsert({
    where: { userId },
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

  // ── 6. Fetch fresh user for new JWT ──────────────────────────────────────────
  const updatedUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, isDefault: true },
  });

  const token = await signSession({
    sub:                updatedUser.id,
    name:               updatedUser.name,
    isDefault:          updatedUser.isDefault,
    onboardingCompleted: true,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieOptions(token));
  return res;
}
