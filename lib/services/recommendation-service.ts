import { prisma } from "@/lib/prisma";
import { scoreJob } from "@/lib/recommendation/scoring";

export type RecommendationRunResult = {
  status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  windowHours: number;
  jobsScanned: number;
  recommendationsCreated: number;
  recommendationsUpdated: number;
  errorSummary?: string;
  runId?: string;
};

/**
 * Run the recommendation engine over a time window.
 * Deduplicates by (jobId, roleProfileId) — never resets status.
 * Updates score/reason/matched/negatives on existing recommendations.
 */
export async function runRecommendations(
  windowHours = 1,
): Promise<RecommendationRunResult> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);

  const run = await prisma.recommendationRun.create({
    data: {
      status: "RUNNING",
      windowStart,
      windowEnd,
    },
  });

  let jobsScanned = 0;
  let recommendationsCreated = 0;
  let recommendationsUpdated = 0;
  let errorSummary: string | undefined;

  try {
    // Load jobs within the effectiveNewAt window (DB-level filter, not in-memory)
    const jobs = await prisma.job.findMany({
      where: {
        isActive: true,
        effectiveNewAt: {
          gte: windowStart,
          lte: windowEnd,
        },
      },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        department: true,
        employmentType: true,
        description: true,
        sponsorship: true,
        postedAt: true,
        firstSeenAt: true,
        effectiveNewAt: true,
      },
    });

    jobsScanned = jobs.length;

    // Load enabled role profiles
    const profiles = await prisma.roleProfile.findMany({
      where: { enabled: true },
      orderBy: { priority: "desc" },
    });

    if (profiles.length === 0) {
      await prisma.recommendationRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "SUCCESS",
          jobsScanned,
          recommendationsCreated: 0,
          errorSummary: "No enabled role profiles found.",
        },
      });
      return {
        status: "SUCCESS",
        windowHours,
        jobsScanned,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        errorSummary: "No enabled role profiles found.",
        runId: run.id,
      };
    }

    // Score each job against each profile
    for (const job of jobs) {
      for (const profile of profiles) {
        try {
          const result = scoreJob(job, profile);

          if (!result.qualified) continue;

          const existing = await prisma.jobRecommendation.findUnique({
            where: { jobId_roleProfileId: { jobId: job.id, roleProfileId: profile.id } },
            select: { id: true },
          });

          if (existing) {
            // Update score/reason/matched/negatives — do NOT reset status or recommendedAt
            await prisma.jobRecommendation.update({
              where: { id: existing.id },
              data: {
                score: result.score,
                reason: result.reason,
                matched: JSON.stringify(result.matched),
                negatives: JSON.stringify(result.negatives),
              },
            });
            recommendationsUpdated++;
          } else {
            await prisma.jobRecommendation.create({
              data: {
                jobId: job.id,
                roleProfileId: profile.id,
                score: result.score,
                reason: result.reason,
                matched: JSON.stringify(result.matched),
                negatives: JSON.stringify(result.negatives),
                status: "UNSEEN",
              },
            });
            recommendationsCreated++;
          }
        } catch (err) {
          console.error(
            `Scoring error job=${job.id} profile=${profile.id}:`,
            err,
          );
        }
      }
    }

    await prisma.recommendationRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "SUCCESS",
        jobsScanned,
        recommendationsCreated,
      },
    });

    return {
      status: "SUCCESS",
      windowHours,
      jobsScanned,
      recommendationsCreated,
      recommendationsUpdated,
      runId: run.id,
    };
  } catch (err) {
    errorSummary =
      err instanceof Error ? err.message : "Unknown recommendation error";

    await prisma.recommendationRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "FAILED",
        jobsScanned,
        recommendationsCreated,
        errorSummary,
      },
    });

    return {
      status: "FAILED",
      windowHours,
      jobsScanned,
      recommendationsCreated,
      recommendationsUpdated,
      errorSummary,
      runId: run.id,
    };
  }
}
