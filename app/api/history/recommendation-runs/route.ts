import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/services/user-recommendation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp       = request.nextUrl.searchParams;
  const page     = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize") || 20)), 100);
  const skip     = (page - 1) * pageSize;
  const status   = sp.get("status");

  let userId: string;
  try {
    userId = await getDefaultUserId();
  } catch {
    return NextResponse.json({ total: 0, page, pageSize, runs: [] });
  }

  const where: Record<string, unknown> = { userId };
  if (status) where.status = status;

  const [total, runs] = await Promise.all([
    prisma.userRecommendationRun.count({ where }),
    prisma.userRecommendationRun.findMany({
      where,
      skip,
      take:    pageSize,
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const runsWithDuration = runs.map((r) => ({
    ...r,
    durationMs:  r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    windowHours: Math.round((r.windowEnd.getTime() - r.windowStart.getTime()) / 3_600_000),
  }));

  return NextResponse.json({ total, page, pageSize, runs: runsWithDuration });
}
