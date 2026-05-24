/**
 * Hourly scheduler using node-cron.
 * Only starts when ENABLE_SCHEDULER=true (Docker production).
 * Defaults to false in development to prevent hot-reload duplicates.
 *
 * Uses an in-memory lock to prevent overlapping runs.
 */
import cron from "node-cron";
import { runRecommendations } from "@/lib/services/recommendation-service";
import { recoverAbandonedRuns } from "@/lib/services/run-recovery-service";
import { runSync } from "@/lib/services/sync-service";

let isRunning = false;
let isScheduled = false;

async function runHourlyJob() {
  if (isRunning) {
    console.log("[scheduler] Skipping — previous run still in progress");
    return;
  }

  isRunning = true;
  console.log("[scheduler] Starting hourly job at", new Date().toISOString());

  try {
    // Recover any runs abandoned by previous crashes before starting new ones
    await recoverAbandonedRuns(30);

    // Sync jobs (parallel fetch, serialised DB writes)
    const syncResult = await runSync();
    console.log(
      `[scheduler] Sync done — created=${syncResult.jobsCreated} updated=${syncResult.jobsUpdated} stale=${syncResult.jobsMarkedStale} failed=${syncResult.sourcesFailed}/${syncResult.sourcesProcessed} (${(syncResult.durationMs / 1000).toFixed(1)}s)`,
    );

    // Run recommendations for last 1 hour
    const recResult = await runRecommendations(1);
    console.log(
      `[scheduler] Recommendations done — scanned=${recResult.jobsScanned} created=${recResult.recommendationsCreated}`,
    );

    // Send notification for newly created recommendations only
    const { sendRecommendationNotification } = await import(
      "@/lib/services/notification-service"
    );

    if (recResult.recommendationsCreated > 0 && recResult.runId) {
      const { prisma } = await import("@/lib/prisma");
      const windowStart = new Date(Date.now() - 60 * 60 * 1000);
      const newRecs = await prisma.jobRecommendation.findMany({
        where: { status: "UNSEEN", recommendedAt: { gte: windowStart } },
        take: 50,
        orderBy: { score: "desc" },
        select: {
          score: true,
          job: { select: { company: true, title: true, applyUrl: true } },
          roleProfile: { select: { name: true } },
        },
      });
      await sendRecommendationNotification({
        windowHours: 1,
        recommendationRunId: recResult.runId,
        newRecommendations: newRecs,
      });
      console.log(
        `[scheduler] Notification sent for ${newRecs.length} new recommendations`,
      );
    } else {
      await sendRecommendationNotification({
        windowHours: 1,
        recommendationRunId: recResult.runId,
        newRecommendations: [],
      });
    }
  } catch (err) {
    console.error("[scheduler] Hourly job failed:", err);
  } finally {
    isRunning = false;
  }
}

export function startScheduler() {
  if (isScheduled) return;
  if (process.env.ENABLE_SCHEDULER !== "true") {
    console.log("[scheduler] Disabled (ENABLE_SCHEDULER != true)");
    return;
  }

  isScheduled = true;
  // Run at the top of every hour
  cron.schedule("0 * * * *", () => {
    runHourlyJob().catch((err) =>
      console.error("[scheduler] Unhandled error:", err),
    );
  });

  console.log("[scheduler] Started — running hourly at :00");
}
