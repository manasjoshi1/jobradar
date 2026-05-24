import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/services/user-recommendation-service";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

async function countUniqueJobs(where: Prisma.UserJobRecommendationWhereInput) {
  const rows = await prisma.userJobRecommendation.findMany({
    where,
    select:   { jobId: true },
    distinct: ["jobId"],
  });
  return rows.length;
}

export async function GET() {
  let userId: string;
  try {
    userId = await getDefaultUserId();
  } catch {
    return NextResponse.json({ error: "No default user" }, { status: 500 });
  }

  const [
    rawLast1h, rawLast2h, rawLast3h, rawLast6h, rawLast12h,
    rawLast1d, rawLast2d, rawLast7d, rawUnseen, rawUnnotified,
    uLast1h, uLast2h, uLast3h, uLast6h, uLast12h,
    uLast1d, uLast2d, uLast7d, uUnseen, uUnnotified,
  ] = await Promise.all([
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(1) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(2) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(3) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(6) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(12) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(24) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(48) } } }),
    prisma.userJobRecommendation.count({ where: { userId, recommendedAt: { gte: hoursAgo(168) } } }),
    prisma.userJobRecommendation.count({ where: { userId, status: "UNSEEN" } }),
    prisma.userJobRecommendation.count({ where: { userId, notifiedAt: null, status: "UNSEEN" } }),

    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(1) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(2) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(3) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(6) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(12) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(24) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(48) } }),
    countUniqueJobs({ userId, recommendedAt: { gte: hoursAgo(168) } }),
    countUniqueJobs({ userId, status: "UNSEEN" }),
    countUniqueJobs({ userId, notifiedAt: null, status: "UNSEEN" }),
  ]);

  return NextResponse.json({
    uniqueJobs: {
      last1h: uLast1h, last2h: uLast2h, last3h: uLast3h, last6h: uLast6h,
      last12h: uLast12h, last1d: uLast1d, last2d: uLast2d, last7d: uLast7d,
      unseen: uUnseen, unnotified: uUnnotified,
    },
    recommendations: {
      last1h: rawLast1h, last2h: rawLast2h, last3h: rawLast3h, last6h: rawLast6h,
      last12h: rawLast12h, last1d: rawLast1d, last2d: rawLast2d, last7d: rawLast7d,
      unseen: rawUnseen, unnotified: rawUnnotified,
    },
    unseen: uUnseen,
  });
}
