/**
 * Recovers SyncRun and RecommendationRun rows that are stuck as RUNNING.
 * Called at scheduler startup and before each manual sync/recommend run.
 * Safe to call frequently — only touches rows older than thresholdMinutes.
 */
import { prisma } from "@/lib/prisma";

export async function recoverAbandonedRuns(thresholdMinutes = 30): Promise<void> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const errorSummary = `Recovered: stuck RUNNING for >${thresholdMinutes}m -- lost to restart/deploy/crash.`;

  const [syncResult, recResult] = await Promise.all([
    prisma.syncRun.updateMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff } },
      data: { status: "FAILED", finishedAt: new Date(), errorSummary },
    }),
    prisma.recommendationRun.updateMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff } },
      data: { status: "FAILED", finishedAt: new Date(), errorSummary },
    }),
  ]);

  const total = syncResult.count + recResult.count;
  if (total > 0) {
    console.log(
      `[run-recovery] Recovered ${syncResult.count} stuck SyncRun(s) + ${recResult.count} RecommendationRun(s)`,
    );
  }
}
