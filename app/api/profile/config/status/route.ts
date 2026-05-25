/**
 * GET /api/profile/config/status
 *
 * Returns the current user's full config snapshot, including:
 *   onboarding — onboarding state (completed, requiresReboarding, reason)
 *   config     — derived config readiness (sources mode, needsSourceSetup)
 *   ui         — next screen hint for the frontend
 *   preferences, roleProfiles, sources — full data for the ProfileConfigPanel
 *
 * nextScreen values:
 *   ONBOARDING   — user has never completed onboarding OR requiresReboarding=true
 *   SOURCE_SETUP — onboarded but has zero per-user sources AND no global sources
 *   DASHBOARD    — normal operating state (may have GLOBAL_FALLBACK for sources)
 *
 * sourceMode values:
 *   USER_SELECTED    — user has explicit UserJobSource rows
 *   GLOBAL_FALLBACK  — no user sources; sync uses all globally enabled sources
 *   NONE             — no user sources and no global sources enabled
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";
import { resolveUserSources } from "@/lib/services/source-resolution";

export const dynamic = "force-dynamic";

function safeJson(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

export async function GET() {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user, prefs, profiles, userSources, onboardingRow, sourceResolution] =
    await Promise.all([
      prisma.user.findUnique({
        where:  { id: userId },
        select: { id: true, name: true, email: true, fullName: true },
      }),
      prisma.userJobPreference.findUnique({ where: { userId } }),
      prisma.userRoleProfile.findMany({
        where:   { userId },
        orderBy: [{ priority: "desc" }, { name: "asc" }],
      }),
      prisma.userJobSource.findMany({
        where:   { userId },
        include: { source: true },
        orderBy: [{ priority: "desc" }, { source: { company: "asc" } }],
      }),
      prisma.userOnboarding.findUnique({
        where:  { userId },
        select: {
          completedAt:        true,
          onboardingVersion:  true,
          requiresReboarding: true,
          reboardingReason:   true,
        },
      }),
      resolveUserSources(userId),
    ]);

  // ── Onboarding state ────────────────────────────────────────────────────────
  // Source of truth: completedAt (ever-set timestamp), not the boolean flag.
  // No onboarding row = legacy user who predates the system → treat as complete.
  const completed          = onboardingRow ? onboardingRow.completedAt !== null : true;
  const requiresReboarding = onboardingRow?.requiresReboarding ?? false;

  const onboarding = {
    completed,
    completedAt:      onboardingRow?.completedAt?.toISOString() ?? null,
    version:          onboardingRow?.onboardingVersion ?? 1,
    requiresReboarding,
    reboardingReason: onboardingRow?.reboardingReason ?? null,
  };

  // ── Config readiness (via centralized resolver) ──────────────────────────────
  const sourceCount = userSources.length;

  // Map source-resolution mode to the legacy UI names for backward compat
  const sourceModeMap: Record<string, "USER_SELECTED" | "GLOBAL_FALLBACK" | "NONE"> = {
    profile:         "USER_SELECTED",
    global_defaults: "GLOBAL_FALLBACK",
    none:            "NONE",
  };
  const sourceMode = sourceModeMap[sourceResolution.mode] ?? "NONE";

  // needsSourceSetup: onboarded AND source mode is "none" (no sources, not opted in)
  const needsSourceSetup = completed && !requiresReboarding && sourceResolution.mode === "none";

  const config = {
    hasPreferences:          prefs !== null,
    hasSources:              sourceCount > 0,
    sourceCount,
    sourceMode,
    useGlobalDefaultSources: sourceResolution.useGlobalDefaultSources,
    globalSourceCount:       sourceResolution.globalSourceCount,
    canSync:                 sourceResolution.canSync,
    needsSourceSetup,
  };

  // ── UI hint ─────────────────────────────────────────────────────────────────
  let nextScreen: "ONBOARDING" | "SOURCE_SETUP" | "DASHBOARD";
  let message: string | null = null;

  if (!completed || requiresReboarding) {
    nextScreen = "ONBOARDING";
    message    = requiresReboarding
      ? (onboardingRow?.reboardingReason ?? "Your profile needs to be updated.")
      : null;
  } else if (needsSourceSetup) {
    nextScreen = "SOURCE_SETUP";
    message    = "No job sources are configured. Upload a source list or ask your admin to add global sources.";
  } else {
    nextScreen = "DASHBOARD";
    if (sourceMode === "GLOBAL_FALLBACK") {
      message = "Using global job sources (opt-in). Add your own sources in Profile → Sources to customise.";
    }
  }

  const ui = { nextScreen, message };

  // ── Preferences ─────────────────────────────────────────────────────────────
  const preferences = prefs
    ? {
        configured:              true,
        targetRoles:             safeJson(prefs.targetRoles),
        targetLocations:         safeJson(prefs.targetLocations),
        minScore:                prefs.minScore,
        requiresSponsorship:     prefs.requiresSponsorship,
        preferredCompanies:      safeJson(prefs.preferredCompanies),
        blockedCompanies:        safeJson(prefs.blockedCompanies),
        useGlobalDefaultSources: prefs.useGlobalDefaultSources,
      }
    : {
        configured:              false,
        targetRoles:             [],
        targetLocations:         [],
        minScore:                45,
        requiresSponsorship:     false,
        preferredCompanies:      [],
        blockedCompanies:        [],
        useGlobalDefaultSources: false,
      };

  return NextResponse.json({
    user: user ?? { id: userId, name: null, email: null, fullName: null },
    onboarding,
    config,
    ui,
    preferences,
    roleProfiles: {
      total:   profiles.length,
      enabled: profiles.filter((p) => p.enabled).length,
      items:   profiles.map((p) => ({
        id:                  p.id,
        name:                p.name,
        enabled:             p.enabled,
        priority:            p.priority,
        minScore:            p.minScore,
        requiresSponsorship: p.requiresSponsorship,
        preferredTitles:     safeJson(p.preferredTitles),
        mustHaveKeywords:    safeJson(p.mustHaveKeywords),
        niceHaveKeywords:    safeJson(p.niceHaveKeywords),
        negativeKeywords:    safeJson(p.negativeKeywords),
        preferredLocations:  safeJson(p.preferredLocations),
      })),
    },
    sources: {
      total:   userSources.length,
      enabled: userSources.filter((s) => s.enabled).length,
      items:   userSources.map((s) => ({
        id:             s.id,
        sourceId:       s.sourceId,
        company:        s.source.company,
        provider:       s.source.provider,
        boardToken:     s.source.boardToken,
        url:            s.source.url,
        enabled:        s.enabled,
        priority:       s.priority,
        tags:           safeJson(s.tags),
        lastSyncStatus: s.source.lastSyncStatus,
        lastSyncAt:     s.source.lastSyncAt,
      })),
    },
  });
}
