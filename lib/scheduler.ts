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

    // Run recommendations — use 24h window so jobs from any recent sync are scored
    const recResult = await runRecommendations(24);
    console.log(
      `[scheduler] Recommendations done — scanned=${recResult.jobsScanned} created=${recResult.recommendationsCreated} updated=${recResult.recommendationsUpdated}`,
    );

    const { sendRecommendationNotification } = await import(
      "@/lib/services/notification-service"
    );
    const { prisma } = await import("@/lib/prisma");

    // Check how long ago we last successfully sent a notification
    const lastSent = await prisma.notificationDelivery.findFirst({
      where: { status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    const hoursSinceLastSent = lastSent?.sentAt
      ? (Date.now() - new Date(lastSent.sentAt).getTime()) / (1000 * 60 * 60)
      : 999;

    // Fetch ALL current UNSEEN recommendations (not just from this run)
    const unseenRecs = await prisma.jobRecommendation.findMany({
      where: { status: "UNSEEN" },
      take: 50,
      orderBy: { score: "desc" },
      select: {
        score: true,
        job: { select: { company: true, title: true, applyUrl: true } },
        roleProfile: { select: { name: true } },
      },
    });

    // Send if: new recs were created this run, OR unseen recs exist and it has
    // been at least 4 hours since the last notification (digest mode).
    const shouldNotify =
      recResult.recommendationsCreated > 0 ||
      (unseenRecs.length > 0 && hoursSinceLastSent >= 4);

    if (shouldNotify) {
      await sendRecommendationNotification({
        windowHours: 24,
        recommendationRunId: recResult.runId,
        newRecommendations: unseenRecs,
      });
      console.log(
        `[scheduler] Notification sent — ${unseenRecs.length} unseen recs (newThisRun=${recResult.recommendationsCreated}, hoursSinceLast=${hoursSinceLastSent.toFixed(1)})`,
      );
    } else {
      console.log(
        `[scheduler] Notification skipped — ${unseenRecs.length} unseen, ${hoursSinceLastSent.toFixed(1)}h since last sent`,
      );
      await sendRecommendationNotification({
        windowHours: 24,
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
