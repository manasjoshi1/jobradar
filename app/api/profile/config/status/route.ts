/**
 * GET /api/profile/config/status
 * Returns current user's full config snapshot.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

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

  const [user, prefs, profiles, userSources] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, fullName: true },
    }),
    prisma.userJobPreference.findUnique({ where: { userId } }),
    prisma.userRoleProfile.findMany({
      where: { userId },
      orderBy: [{ priority: "desc" }, { name: "asc" }],
    }),
    prisma.userJobSource.findMany({
      where: { userId },
      include: { source: true },
      orderBy: [{ priority: "desc" }, { source: { company: "asc" } }],
    }),
  ]);

  return NextResponse.json({
    user: user ?? { id: userId, name: null, email: null, fullName: null },
    preferences: prefs
      ? {
          configured: true,
          targetRoles: safeJson(prefs.targetRoles),
          targetLocations: safeJson(prefs.targetLocations),
          minScore: prefs.minScore,
          requiresSponsorship: prefs.requiresSponsorship,
          preferredCompanies: safeJson(prefs.preferredCompanies),
          blockedCompanies: safeJson(prefs.blockedCompanies),
        }
      : { configured: false, targetRoles: [], targetLocations: [], minScore: 45, requiresSponsorship: false, preferredCompanies: [], blockedCompanies: [] },
    roleProfiles: {
      total: profiles.length,
      enabled: profiles.filter((p) => p.enabled).length,
      items: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        priority: p.priority,
        minScore: p.minScore,
        requiresSponsorship: p.requiresSponsorship,
        preferredTitles: safeJson(p.preferredTitles),
        mustHaveKeywords: safeJson(p.mustHaveKeywords),
        niceHaveKeywords: safeJson(p.niceHaveKeywords),
        negativeKeywords: safeJson(p.negativeKeywords),
        preferredLocations: safeJson(p.preferredLocations),
      })),
    },
    sources: {
      total: userSources.length,
      enabled: userSources.filter((s) => s.enabled).length,
      items: userSources.map((s) => ({
        id: s.id,
        sourceId: s.sourceId,
        company: s.source.company,
        provider: s.source.provider,
        boardToken: s.source.boardToken,
        url: s.source.url,
        enabled: s.enabled,
        priority: s.priority,
        tags: safeJson(s.tags),
        lastSyncStatus: s.source.lastSyncStatus,
        lastSyncAt: s.source.lastSyncAt,
      })),
    },
  });
}
