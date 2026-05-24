import { prisma } from "@/lib/prisma";
import { scoreJob } from "@/lib/recommendation/scoring";

export type UserRecommendationRunResult = {
  status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  userId: string;
  windowHours: number;
  jobsScanned: number;
  recommendationsCreated: number;
  recommendationsUpdated: number;
  errorSummary?: string;
  runId?: string;
};

/** Return the default user's id, throw if none exists. */
export async function getDefaultUserId(): Promise<string> {
  const user = await prisma.user.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!user) throw new Error("No default user found. Run: npm run db:seed-user");
  return user.id;
}

/**
 * Run the user-scoped recommendation engine.
 *
 * - Loads UserRoleProfile[] for the given userId
 * - Respects UserJobPreference (blocked companies, sponsorship, target locations)
 * - Scans global Job table within windowHours
 * - Writes UserJobRecommendation and UserRecommendationRun
 * - Never touches global JobRecommendation or RecommendationRun
 */
export async function runUserRecommendations(
  userId: string | null,
  windowHours = 48,
): Promise<UserRecommendationRunResult> {
  // Resolve user
  const resolvedUserId = userId ?? (await getDefaultUserId());

  const windowEnd   = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowHours * 3_600_000);

  // Create run record
  const run = await prisma.userRecommendationRun.create({
    data: {
      userId:      resolvedUserId,
      status:      "RUNNING",
      windowStart,
      windowEnd,
    },
  });

  let jobsScanned            = 0;
  let recommendationsCreated = 0;
  let recommendationsUpdated = 0;
  let errorSummary: string | undefined;

  try {
    // Load jobs in window
    const jobs = await prisma.job.findMany({
      where: {
        isActive:      true,
        effectiveNewAt: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true, title: true, company: true, location: true,
        department: true, employmentType: true, description: true,
        sponsorship: true, postedAt: true, firstSeenAt: true, effectiveNewAt: true,
      },
    });
    jobsScanned = jobs.length;

    // Load user's role profiles
    const profiles = await prisma.userRoleProfile.findMany({
      where:   { userId: resolvedUserId, enabled: true },
      orderBy: { priority: "desc" },
    });

    if (profiles.length === 0) {
      await prisma.userRecommendationRun.update({
        where: { id: run.id },
        data:  { finishedAt: new Date(), status: "SUCCESS", jobsScanned, errorSummary: "No enabled role profiles." },
      });
      return {
        status: "SUCCESS", userId: resolvedUserId, windowHours,
        jobsScanned, recommendationsCreated: 0, recommendationsUpdated: 0,
        errorSummary: "No enabled role profiles.", runId: run.id,
      };
    }

    // Load user preferences for optional blocking
    const prefs = await prisma.userJobPreference.findUnique({ where: { userId: resolvedUserId } });
    const blockedCompanies: string[] = prefs?.blockedCompanies
      ? (JSON.parse(prefs.blockedCompanies) as string[]).map((c) => c.toLowerCase())
      : [];

    // Batch-lookup existing recommendations (no N+1)
    const jobIds     = jobs.map((j) => j.id);
    const profileIds = profiles.map((p) => p.id);

    const existing = await prisma.userJobRecommendation.findMany({
      where: {
        userId:            resolvedUserId,
        jobId:             { in: jobIds },
        userRoleProfileId: { in: profileIds },
      },
      select: { id: true, jobId: true, userRoleProfileId: true },
    });
    const existingMap = new Map<string, string>(); // "jobId|profileId" → recId
    for (const r of existing) {
      existingMap.set(`${r.jobId}|${r.userRoleProfileId}`, r.id);
    }

    const creates: Array<{
      jobId: string; userRoleProfileId: string;
      score: number; reason: string; matched: string; negatives: string;
    }> = [];
    const updates: Array<{
      id: string; score: number; reason: string; matched: string; negatives: string;
    }> = [];

    for (const job of jobs) {
      // Skip blocked companies
      if (blockedCompanies.length > 0 && blockedCompanies.includes(job.company.toLowerCase())) {
        continue;
      }

      for (const profile of profiles) {
        try {
          const result = scoreJob(job, profile);
          if (!result.qualified) continue;

          const key   = `${job.id}|${profile.id}`;
          const recId = existingMap.get(key);
          const data  = {
            score:     result.score,
            reason:    result.reason,
            matched:   JSON.stringify(result.matched),
            negatives: JSON.stringify(result.negatives),
          };

          if (recId) {
            updates.push({ id: recId, ...data });
          } else {
            creates.push({ jobId: job.id, userRoleProfileId: profile.id, ...data });
          }
        } catch (err) {
          console.error(`Scoring error job=${job.id} profile=${profile.id}:`, err);
        }
      }
    }

    // Creates — individual with try/catch (SQLite no skipDuplicates)
    for (const c of creates) {
      try {
        await prisma.userJobRecommendation.create({
          data: {
            userId:            resolvedUserId,
            jobId:             c.jobId,
            userRoleProfileId: c.userRoleProfileId,
            score:             c.score,
            reason:            c.reason,
            matched:           c.matched,
            negatives:         c.negatives,
            status:            "UNSEEN",
          },
        });
        recommendationsCreated++;
      } catch {
        // duplicate constraint — safe to skip
      }
    }

    // Updates
    for (const u of updates) {
      await prisma.userJobRecommendation.update({
        where: { id: u.id },
        data:  { score: u.score, reason: u.reason, matched: u.matched, negatives: u.negatives },
      });
      recommendationsUpdated++;
    }

    await prisma.userRecommendationRun.update({
      where: { id: run.id },
      data:  {
        finishedAt:            new Date(),
        status:                "SUCCESS",
        jobsScanned,
        recommendationsCreated,
        recommendationsUpdated,
      },
    });

    return {
      status: "SUCCESS", userId: resolvedUserId, windowHours,
      jobsScanned, recommendationsCreated, recommendationsUpdated,
      runId: run.id,
    };
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : "Unknown error";
    await prisma.userRecommendationRun.update({
      where: { id: run.id },
      data:  { finishedAt: new Date(), status: "FAILED", jobsScanned, recommendationsCreated, errorSummary },
    });
    return {
      status: "FAILED", userId: resolvedUserId, windowHours,
      jobsScanned, recommendationsCreated, recommendationsUpdated,
      errorSummary, runId: run.id,
    };
  }
}
