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

    // Sync jobs
    const { prisma } = await import("@/lib/prisma");
    const { fetchJobsFromSource } = await import("@/lib/providers");
    const { detectSponsorship } = await import("@/lib/sponsorship");

    const sources = await prisma.jobSource.findMany({
      where: { enabled: true },
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    });

    const syncRun = await prisma.syncRun.create({
      data: { status: "RUNNING", sourcesProcessed: sources.length },
    });

    let sourcesSucceeded = 0;
    let sourcesFailed = 0;
    let jobsCreated = 0;
    let jobsUpdated = 0;
    let jobsMarkedStale = 0;

    for (const source of sources) {
      const sourceRun = await prisma.syncSourceRun.create({
        data: {
          syncRunId: syncRun.id,
          sourceId: source.id,
          company: source.company,
          provider: source.provider,
          status: "SKIPPED",
        },
      });

      try {
        const jobs = await fetchJobsFromSource(source);
        let created = 0;
        let updated = 0;
        const seenUrls = new Set<string>();

        for (const job of jobs) {
          seenUrls.add(job.applyUrl);
          const existing = await prisma.job.findUnique({
            where: { sourceId_applyUrl: { sourceId: source.id, applyUrl: job.applyUrl } },
            select: { id: true, postedAt: true },
          });

          const sponsorship = detectSponsorship(
            [job.title, job.description, job.location, job.department].filter(Boolean).join(" "),
          );
          const now = new Date();
          const postedAt = job.postedAt ? new Date(job.postedAt) : null;
          const effectiveNewAt = postedAt ?? now;
          const needEffectiveUpdate = postedAt && existing && !existing.postedAt;

          await prisma.job.upsert({
            where: { sourceId_applyUrl: { sourceId: source.id, applyUrl: job.applyUrl } },
            create: {
              sourceId: source.id,
              externalId: job.externalId || null,
              company: job.company,
              title: job.title,
              location: job.location || null,
              department: job.department || null,
              employmentType: job.employmentType || null,
              applyUrl: job.applyUrl,
              description: job.description || null,
              postedAt,
              effectiveNewAt,
              sponsorship,
              status: "NEW",
              firstSeenAt: now,
              lastSeenAt: now,
              isActive: true,
            },
            update: {
              externalId: job.externalId || null,
              company: job.company,
              title: job.title,
              location: job.location || null,
              department: job.department || null,
              employmentType: job.employmentType || null,
              description: job.description || null,
              postedAt,
              ...(needEffectiveUpdate ? { effectiveNewAt: postedAt! } : {}),
              sponsorship,
              lastSeenAt: now,
              isActive: true,
            },
          });

          if (existing) { updated++; } else { created++; }
        }

        const staleResult = seenUrls.size > 0
          ? await prisma.job.updateMany({
              where: { sourceId: source.id, applyUrl: { notIn: [...seenUrls] }, isActive: true },
              data: { isActive: false },
            })
          : await prisma.job.updateMany({
              where: { sourceId: source.id, isActive: true },
              data: { isActive: false },
            });

        jobsCreated += created;
        jobsUpdated += updated;
        jobsMarkedStale += staleResult.count;

        await prisma.jobSource.update({
          where: { id: source.id },
          data: { lastSyncAt: new Date(), lastSyncStatus: `OK: ${jobs.length} jobs` },
        });
        await prisma.syncSourceRun.update({
          where: { id: sourceRun.id },
          data: { status: "SUCCESS", jobsFetched: jobs.length, jobsCreated: created, jobsUpdated: updated, finishedAt: new Date() },
        });
        sourcesSucceeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await prisma.jobSource.update({
          where: { id: source.id },
          data: { lastSyncAt: new Date(), lastSyncStatus: `ERROR: ${msg.slice(0, 240)}` },
        });
        await prisma.syncSourceRun.update({
          where: { id: sourceRun.id },
          data: { status: "FAILED", errorMessage: msg.slice(0, 1000), finishedAt: new Date() },
        });
        sourcesFailed++;
      }
    }

    const syncStatus = sourcesFailed === 0 ? "SUCCESS" : sourcesSucceeded === 0 ? "FAILED" : "PARTIAL_FAILURE";
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { finishedAt: new Date(), status: syncStatus, sourcesSucceeded, sourcesFailed, jobsCreated, jobsUpdated, jobsMarkedStale },
    });

    console.log(`[scheduler] Sync done — created=${jobsCreated} updated=${jobsUpdated} stale=${jobsMarkedStale}`);

    // Run recommendations for last 1 hour
    const recResult = await runRecommendations(1);
    console.log(
      `[scheduler] Recommendations done — scanned=${recResult.jobsScanned} created=${recResult.recommendationsCreated}`,
    );

    // Send notification for newly created recommendations only
    if (recResult.recommendationsCreated > 0 && recResult.runId) {
      const { sendRecommendationNotification } = await import("@/lib/services/notification-service");
      // Load the newly created UNSEEN recommendations from this run's window
      const windowStart = new Date(Date.now() - 60 * 60 * 1000);
      const newRecs = await prisma.jobRecommendation.findMany({
        where: {
          status: "UNSEEN",
          recommendedAt: { gte: windowStart },
        },
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
      console.log(`[scheduler] Notification sent for ${newRecs.length} new recommendations`);
    } else {
      // Record a SKIPPED delivery even when nothing new
      const { sendRecommendationNotification } = await import("@/lib/services/notification-service");
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
