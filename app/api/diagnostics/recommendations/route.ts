import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 3_600_000);
  const d7 = new Date(now.getTime() - 7 * 24 * 3_600_000);

  const [
    profileTotal,
    profileEnabled,
    profileSample,
    jobTotal,
    jobActive,
    jobWithENA,
    jobLast24h,
    jobLast7d,
    latestENA,
    recTotal,
    recUnseen,
    recLast24h,
    lastRecRun,
    lastSyncRun,
  ] = await Promise.all([
    prisma.roleProfile.count(),
    prisma.roleProfile.count({ where: { enabled: true } }),
    prisma.roleProfile.findMany({
      take: 5,
      orderBy: { priority: "desc" },
      select: { id: true, name: true, enabled: true, minScore: true, priority: true },
    }),
    prisma.job.count(),
    prisma.job.count({ where: { isActive: true } }),
    prisma.job.count({ where: { effectiveNewAt: { not: null } } }),
    prisma.job.count({ where: { isActive: true, effectiveNewAt: { gte: h24 } } }),
    prisma.job.count({ where: { isActive: true, effectiveNewAt: { gte: d7 } } }),
    prisma.job.findFirst({ orderBy: { effectiveNewAt: "desc" }, select: { effectiveNewAt: true } }),
    prisma.jobRecommendation.count(),
    prisma.jobRecommendation.count({ where: { status: "UNSEEN" } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: h24 } } }),
    prisma.recommendationRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  return NextResponse.json({
    databaseUrl: process.env.DATABASE_URL?.replace(/\/[^/]+$/, "/***") ?? "unknown",
    configDir: process.env.CONFIG_DIR ?? "./config",
    roleProfiles: { total: profileTotal, enabled: profileEnabled, sample: profileSample },
    jobs: {
      total: jobTotal,
      active: jobActive,
      withEffectiveNewAt: jobWithENA,
      last24h: jobLast24h,
      last7d: jobLast7d,
      latestEffectiveNewAt: latestENA?.effectiveNewAt ?? null,
    },
    recommendations: { total: recTotal, unseen: recUnseen, last24h: recLast24h },
    lastRecommendationRun: lastRecRun,
    lastSyncRun,
  });
}
