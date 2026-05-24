import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await prisma.jobSource.findMany({
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

  // For each source, get active/total job count and latest effectiveNewAt
  const enriched = await Promise.all(
    sources.map(async (s) => {
      const [activeJobCount, totalJobCount, latestJob] = await Promise.all([
        prisma.job.count({ where: { sourceId: s.id, isActive: true } }),
        prisma.job.count({ where: { sourceId: s.id } }),
        prisma.job.findFirst({
          where: { sourceId: s.id },
          orderBy: { lastSeenAt: "desc" },
          select: { lastSeenAt: true },
        }),
      ]);
      return {
        ...s,
        activeJobCount,
        totalJobCount,
        latestJobSeenAt: latestJob?.lastSeenAt ?? null,
      };
    }),
  );

  return NextResponse.json({ sources: enriched });
}
