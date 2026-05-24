/**
 * POST /api/sync/start
 *
 * Kicks off a background sync and returns immediately with { runId }.
 * The caller can poll GET /api/sync/status?runId=<id> for progress.
 *
 * Returns 409 if a sync run is already RUNNING (started within last 10 min).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recoverAbandonedRuns } from "@/lib/services/run-recovery-service";

export const dynamic = "force-dynamic";

export async function POST() {
  await recoverAbandonedRuns(30);

  // Reject if another run is actively in progress (started < 10 min ago)
  const recentRunning = await prisma.syncRun.findFirst({
    where: {
      status: "RUNNING",
      startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    orderBy: { startedAt: "desc" },
  });

  if (recentRunning) {
    return NextResponse.json(
      { error: "A sync run is already in progress", runId: recentRunning.id },
      { status: 409 },
    );
  }

  // Create the run record up-front so the caller has an ID to poll
  const syncRun = await prisma.syncRun.create({
    data: { status: "RUNNING", sourcesProcessed: 0 },
  });

  // Fire-and-forget — do NOT await
  void (async () => {
    try {
      const { runSync } = await import("@/lib/services/sync-service");
      await runSync(syncRun.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.syncRun
        .update({
          where: { id: syncRun.id },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            errorSummary: msg.slice(0, 2000),
          },
        })
        .catch(() => {});
    }
  })();

  return NextResponse.json({ runId: syncRun.id }, { status: 202 });
}
