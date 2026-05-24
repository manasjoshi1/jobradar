import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp       = request.nextUrl.searchParams;
  const page     = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize")) || 50), 200);
  const skip     = (page - 1) * pageSize;

  // 1 query for total count
  const total = await prisma.jobSource.count();

  // 1 query for paginated sources
  const sources = await prisma.jobSource.findMany({
    skip,
    take: pageSize,
    orderBy: [{ enabled: "desc" }, { company: "asc" }],
    select: {
      id: true,
      company: true,
      provider: true,
      enabled: true,
      priority: true,
      tags: true,
      lastSyncAt: true,
      lastSyncStatus: true,
    },
  });

  const sourceIds = sources.map((s) => s.id);

  // Batch: 1 groupBy for active job counts
  const activeGroups = await prisma.job.groupBy({
    by: ["sourceId"],
    where: { sourceId: { in: sourceIds }, isActive: true },
    _count: { _all: true },
  });
  const activeMap = new Map(activeGroups.map((g) => [g.sourceId, g._count._all]));

  // Batch: 1 groupBy for total job counts
  const totalGroups = await prisma.job.groupBy({
    by: ["sourceId"],
    where: { sourceId: { in: sourceIds } },
    _count: { _all: true },
  });
  const totalMap = new Map(totalGroups.map((g) => [g.sourceId, g._count._all]));

  // Batch: 1 query for latest lastSeenAt per source using raw max aggregation
  // Prisma groupBy with _max works for DateTime
  const latestGroups = await prisma.job.groupBy({
    by: ["sourceId"],
    where: { sourceId: { in: sourceIds } },
    _max: { lastSeenAt: true },
  });
  const latestMap = new Map(latestGroups.map((g) => [g.sourceId, g._max.lastSeenAt]));

  const enriched = sources.map((s) => ({
    ...s,
    activeJobCount:    activeMap.get(s.id) ?? 0,
    totalJobCount:     totalMap.get(s.id)  ?? 0,
    latestJobSeenAt:   latestMap.get(s.id) ?? null,
  }));

  return NextResponse.json({
    sources: enriched,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
