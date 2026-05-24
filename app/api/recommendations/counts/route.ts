import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

export async function GET() {
  const [last1h, last2h, last3h, last6h, last12h, last1d, last2d, last7d, unseen] =
    await Promise.all([
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(1) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(2) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(3) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(6) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(12) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(24) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(48) } } }),
      prisma.jobRecommendation.count({ where: { recommendedAt: { gte: hoursAgo(168) } } }),
      prisma.jobRecommendation.count({ where: { status: "UNSEEN" } }),
    ]);

  return NextResponse.json({
    last1h,
    last2h,
    last3h,
    last6h,
    last12h,
    last1d,
    last2d,
    last7d,
    unseen,
  });
}
