import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1));
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize") || 20)), 100);
  const skip = (page - 1) * pageSize;
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (from || to) {
    where.startedAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [total, runs] = await Promise.all([
    prisma.syncRun.count({ where }),
    prisma.syncRun.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        sourcesProcessed: true,
        sourcesSucceeded: true,
        sourcesFailed: true,
        jobsCreated: true,
        jobsUpdated: true,
        jobsMarkedStale: true,
        errorSummary: true,
      },
    }),
  ]);

  const runsWithDuration = runs.map((r) => ({
    ...r,
    durationMs:
      r.finishedAt && r.startedAt
        ? r.finishedAt.getTime() - r.startedAt.getTime()
        : null,
  }));

  return NextResponse.json({ total, page, pageSize, runs: runsWithDuration });
}
