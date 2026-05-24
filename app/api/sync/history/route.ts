import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Fetch latest 20 sync runs with their source runs
    const syncRuns = await prisma.syncRun.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        sourceRuns: {
          select: {
            company: true,
            provider: true,
            status: true,
            jobsFetched: true,
            jobsCreated: true,
            jobsUpdated: true,
            errorMessage: true,
          },
          orderBy: { provider: "asc" },
        },
      },
    });

    return NextResponse.json(syncRuns);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch sync history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
