/**
 * GET /api/me
 *
 * Returns the current (default) user's profile, preferences, and role profile summary.
 * Used by the UI to show "User: Default User" and surface per-user config.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await prisma.user.findFirst({
    where: { isDefault: true },
    select: {
      id: true,
      name: true,
      email: true,
      isDefault: true,
      createdAt: true,
      preferences: {
        select: {
          targetLocations:    true,
          targetRoles:        true,
          blockedCompanies:   true,
          preferredCompanies: true,
          minScore:           true,
          requiresSponsorship: true,
        },
      },
      roleProfiles: {
        select: { id: true, name: true, enabled: true, priority: true, minScore: true },
        orderBy: { priority: "desc" },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "No default user" }, { status: 404 });
  }

  const [recCount, unseenCount, statusCounts] = await Promise.all([
    prisma.userJobRecommendation.count({ where: { userId: user.id } }),
    prisma.userJobRecommendation.count({ where: { userId: user.id, status: "UNSEEN" } }),
    prisma.userJobStatus.groupBy({
      by:    ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
  ]);

  const statusMap = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));

  return NextResponse.json({
    user: {
      ...user,
      preferences: user.preferences
        ? {
            ...user.preferences,
            targetLocations:    safeParseJson(user.preferences.targetLocations),
            targetRoles:        safeParseJson(user.preferences.targetRoles),
            blockedCompanies:   safeParseJson(user.preferences.blockedCompanies),
            preferredCompanies: safeParseJson(user.preferences.preferredCompanies),
          }
        : null,
    },
    stats: {
      totalRecommendations: recCount,
      unseenRecommendations: unseenCount,
      jobStatuses: statusMap,
    },
  });
}

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
