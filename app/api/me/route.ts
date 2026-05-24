/**
 * GET /api/me
 *
 * Returns the current logged-in user's profile, preferences, and role profiles.
 * User is resolved from session cookie (falls back to default user for CLI/bootstrap).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

export async function GET() {
  let userId: string;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isDefault: true,
      createdAt: true,
      preferences: {
        select: {
          targetLocations:     true,
          targetRoles:         true,
          blockedCompanies:    true,
          preferredCompanies:  true,
          minScore:            true,
          requiresSponsorship: true,
        },
      },
      roleProfiles: {
        select: { id: true, name: true, enabled: true, priority: true, minScore: true },
        orderBy: { priority: "desc" },
      },
    },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const [recCount, unseenCount, statusCounts] = await Promise.all([
    prisma.userJobRecommendation.count({ where: { userId } }),
    prisma.userJobRecommendation.count({ where: { userId, status: "UNSEEN" } }),
    prisma.userJobStatus.groupBy({
      by:    ["status"],
      where: { userId },
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
      totalRecommendations:  recCount,
      unseenRecommendations: unseenCount,
      jobStatuses:           statusMap,
    },
  });
}

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
