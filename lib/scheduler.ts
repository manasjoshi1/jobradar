/**
 * Scheduler — every 30 minutes.
 * Only starts when ENABLE_SCHEDULER=true (Docker production).
 *
 * Pipeline per run:
 *   1. Recover abandoned sync runs
 *   2. Sync jobs from all sources
 *   3. Score jobs against role profiles (48h window)
 *   4. Send notification for any unnotified unique jobs (self-managed by service)
 */
import cron from "node-cron";
import { runRecommendations } from "@/lib/services/recommendation-service";
import { recoverAbandonedRuns } from "@/lib/services/run-recovery-service";
import { runSync } from "@/lib/services/sync-service";
import { sendRecommendationNotification } from "@/lib/services/notification-service";

let isRunning  = false;
let isScheduled = false;

async function runScheduledJob() {
  if (isRunning) {
    console.log("[scheduler] Skipping — previous run still in progress");
    return;
  }

  isRunning = true;
  console.log("[scheduler] Run started at", new Date().toISOString());

  try {
    // 1. Recover abandoned runs
    await recoverAbandonedRuns(30);

    // 2. Sync jobs
    const syncResult = await runSync();
    console.log(
      `[scheduler] Sync done — created=${syncResult.jobsCreated} updated=${syncResult.jobsUpdated} ` +
      `stale=${syncResult.jobsMarkedStale} failed=${syncResult.sourcesFailed}/${syncResult.sourcesProcessed} ` +
      `(${(syncResult.durationMs / 1000).toFixed(1)}s)`,
    );

    // 3. Score recommendations (48h window catches all recent jobs)
    const recResult = await runRecommendations(48);
    console.log(
      `[scheduler] Recs done — scanned=${recResult.jobsScanned} ` +
      `created=${recResult.recommendationsCreated} updated=${recResult.recommendationsUpdated}`,
    );

    // 4. Notify — service queries its own unnotified recs, groups by job, dedupes
    await sendRecommendationNotification({ recommendationRunId: recResult.runId });
  } catch (err) {
    console.error("[scheduler] Run failed:", err);
  } finally {
    isRunning = false;
    console.log("[scheduler] Run finished at", new Date().toISOString());
  }
}

export function startScheduler() {
  if (isScheduled) return;
  if (process.env.ENABLE_SCHEDULER !== "true") {
    console.log("[scheduler] Disabled (ENABLE_SCHEDULER != true)");
    return;
  }

  isScheduled = true;
  // Every 30 minutes — max ~30 min lag from job posting to notification
  cron.schedule("*/30 * * * *", () => {
    runScheduledJob().catch((err) =>
      console.error("[scheduler] Unhandled error:", err),
    );
  });

  console.log("[scheduler] Started — every 30 min (:00 and :30)");
}
