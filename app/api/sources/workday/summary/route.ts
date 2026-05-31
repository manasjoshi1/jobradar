import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WORKDAY_SCRAPER_ENABLED } from "@/lib/workday/scraper";

export const dynamic = "force-dynamic";

/**
 * GET /api/sources/workday/summary
 *
 * Workday source-lifecycle health for the admin/Sources UI.
 * Returns counts by verificationStatus + fetchStrategy, enabled/disabled,
 * and whether the browser scraper is currently enabled.
 */
export async function GET() {
  const workday = await prisma.jobSource.findMany({
    where:  { provider: "WORKDAY" },
    select: {
      enabled:            true,
      verificationStatus: true,
      fetchStrategy:      true,
    },
  });

  const total = workday.length;
  let enabled = 0;
  let disabled = 0;

  const byStatus: Record<string, number> = {};
  const byStrategy: Record<string, number> = {};

  for (const s of workday) {
    if (s.enabled) enabled++; else disabled++;

    const status = s.verificationStatus ?? "unverified";
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const strategy = s.fetchStrategy ?? "API";
    byStrategy[strategy] = (byStrategy[strategy] ?? 0) + 1;
  }

  return NextResponse.json({
    scraperEnabled: WORKDAY_SCRAPER_ENABLED,
    total,
    enabled,
    disabled,
    byStatus,
    byStrategy,
  });
}
