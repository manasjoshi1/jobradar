/**
 * GET /api/jobs/new-counts
 *
 * Returns counts of newly-scraped active jobs over multiple time windows,
 * deduped by jobFingerprint where available.
 *
 * Response:
 * {
 *   "last1h":   143,
 *   "last2h":   210,
 *   "last3h":   240,
 *   "last6h":   380,
 *   "last12h":  620,
 *   "last1d":   900,
 *   "last2d":  1400,
 *   "last7d":  3500,
 *   "unnotified": 143   // isActive + allNewJobsNotifiedAt IS NULL (no window restriction)
 * }
 *
 * Note: SQLite doesn't support COUNT(DISTINCT) on a computed expression via Prisma
 * groupBy, so we use raw counts (fingerprint dedup is a best-effort client-side check
 * in the notification service). Counts here are raw job row counts.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "last1h",  ms: 1  * 3_600_000 },
  { key: "last2h",  ms: 2  * 3_600_000 },
  { key: "last3h",  ms: 3  * 3_600_000 },
  { key: "last6h",  ms: 6  * 3_600_000 },
  { key: "last12h", ms: 12 * 3_600_000 },
  { key: "last1d",  ms: 24 * 3_600_000 },
  { key: "last2d",  ms: 48 * 3_600_000 },
  { key: "last7d",  ms: 168 * 3_600_000 },
] as const;

export async function GET() {
  const now = Date.now();

  const [windowCounts, unnotified] = await Promise.all([
    Promise.all(
      WINDOWS.map(({ key, ms }) =>
        prisma.job
          .count({ where: { isActive: true, firstSeenAt: { gte: new Date(now - ms) } } })
          .then((count) => ({ key, count })),
      ),
    ),
    prisma.job.count({ where: { isActive: true, allNewJobsNotifiedAt: null } }),
  ]);

  const result: Record<string, number> = { unnotified };
  for (const { key, count } of windowCounts) {
    result[key] = count;
  }

  return NextResponse.json(result);
}
