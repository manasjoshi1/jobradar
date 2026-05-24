import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

import type { Prisma } from "@prisma/client";

/** Count distinct jobIds matching the given where clause */
async function countUniqueJobs(where: Prisma.JobRecommendationWhereInput) {
  const rows = await prisma.jobRecommendation.findMany({
    where,
    select: { jobId: true },
    distinct: ["jobId"],
  });
  return rows.length;
}

export async function GET() {
  const [
    // Raw recommendation counts (one per job×profile match)
    rawLast1h, rawLast2h, rawLast3h, rawLast6h, rawLast12h,
    rawLast1d, rawLast2d, rawLast7d, rawUnseen, rawUnnotified,

    // Unique job counts
    uLast1h, uLast2h, uLast3h, uLast6h, uLast12h,
    uLast1d, uLast2d, uLast7d, uUnseen, uUnnotified,
  ] = await Promise.all([
    // Raw counts
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(1) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(2) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(3) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(6) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(12) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(24) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(48) } } }),
    prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(168) } } }),
    prisma.jobRecommendation.count({ where: { status: "UNSEEN" } }),
    prisma.jobRecommendation.count({ where: { notifiedAt: null, status: "UNSEEN" } }),

    // Unique job counts
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(1) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(2) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(3) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(6) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(12) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(24) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(48) } }),
    countUniqueJobs({ recommendedAt: { gte: hoursAgo(168) } }),
    countUniqueJobs({ status: "UNSEEN" }),
    countUniqueJobs({ notifiedAt: null, status: "UNSEEN" }),
  ]);

  return NextResponse.json({
    // Unique job counts — use these for UI badges and alerts
    uniqueJobs: {
      last1h: uLast1h, last2h: uLast2h, last3h: uLast3h, last6h: uLast6h,
      last12h: uLast12h, last1d: uLast1d, last2d: uLast2d, last7d: uLast7d,
      unseen: uUnseen, unnotified: uUnnotified,
    },
    // Raw recommendation counts (one per job×profile pair)
    recommendations: {
      last1h: rawLast1h, last2h: rawLast2h, last3h: rawLast3h, last6h: rawLast6h,
      last12h: rawLast12h, last1d: rawLast1d, last2d: rawLast2d, last7d: rawLast7d,
      unseen: rawUnseen, unnotified: rawUnnotified,
    },
    // Keep top-level unseen for backwards compat with any older callers
    unseen: uUnseen,
  });
}
