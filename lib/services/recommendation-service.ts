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
 *
 * Improvements over v1:
 *  - Batch-lookup existing (jobId, roleProfileId) pairs — no N+1 per job
 *  - Always includes jobs seen/posted within `windowHours` based on effectiveNewAt
 *  - Never resets user status (SEEN, SAVED, APPLIED, SKIPPED)
 *  - Updates score/reason/matched/negatives on existing recs
 */
export async function runRecommendations(
  windowHours = 48,
): Promise<RecommendationRunResult> {
  const windowEnd   = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);

  const run = await prisma.recommendationRun.create({
    data: { status: "RUNNING", windowStart, windowEnd },
  });

  let jobsScanned            = 0;
  let recommendationsCreated = 0;
  let recommendationsUpdated = 0;
  let errorSummary: string | undefined;

  try {
    // Load active jobs within the window
    const jobs = await prisma.job.findMany({
      where: {
        isActive: true,
        effectiveNewAt: { gte: windowStart, lte: windowEnd },
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
          errorSummary: "No enabled role profiles.",
        },
      });
      return {
        status: "SUCCESS",
        windowHours,
        jobsScanned,
        recommendationsCreated: 0,
        recommendationsUpdated: 0,
        errorSummary: "No enabled role profiles.",
        runId: run.id,
      };
    }

    const jobIds     = jobs.map((j) => j.id);
    const profileIds = profiles.map((p) => p.id);

    // Batch-load ALL existing recommendations for this job×profile cross product
    // Avoids N+1: one query instead of jobs.length × profiles.length queries
    const existing = await prisma.jobRecommendation.findMany({
      where: {
        jobId:         { in: jobIds },
        roleProfileId: { in: profileIds },
      },
      select: { id: true, jobId: true, roleProfileId: true },
    });

    const existingMap = new Map<string, string>(); // "jobId|profileId" → rec.id
    for (const rec of existing) {
      existingMap.set(`${rec.jobId}|${rec.roleProfileId}`, rec.id);
    }

    // Score each job × profile
    const creates: Array<{
      jobId: string; roleProfileId: string;
      score: number; reason: string; matched: string; negatives: string;
    }> = [];
    const updates: Array<{
      id: string; score: number; reason: string; matched: string; negatives: string;
    }> = [];

    for (const job of jobs) {
      for (const profile of profiles) {
        try {
          const result = scoreJob(job, profile);
          if (!result.qualified) continue;

          const key    = `${job.id}|${profile.id}`;
          const recId  = existingMap.get(key);
          const data   = {
            score:     result.score,
            reason:    result.reason,
            matched:   JSON.stringify(result.matched),
            negatives: JSON.stringify(result.negatives),
          };

          if (recId) {
            updates.push({ id: recId, ...data });
          } else {
            creates.push({ jobId: job.id, roleProfileId: profile.id, ...data });
          }
        } catch (err) {
          console.error(`Scoring error job=${job.id} profile=${profile.id}:`, err);
        }
      }
    }

    // Write creates in a single createMany call
    if (creates.length > 0) {
      await prisma.jobRecommendation.createMany({
        data: creates.map((c) => ({ ...c, status: "UNSEEN" })),
        skipDuplicates: true,
      });
      recommendationsCreated = creates.length;
    }

    // Write updates individually (Prisma SQLite doesn't support bulk update with different values)
    for (const u of updates) {
      await prisma.jobRecommendation.update({
        where: { id: u.id },
        data: { score: u.score, reason: u.reason, matched: u.matched, negatives: u.negatives },
      });
      recommendationsUpdated++;
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
    errorSummary = err instanceof Error ? err.message : "Unknown error";

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
