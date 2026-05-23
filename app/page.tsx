import { JobBoardClient } from "@/components/JobBoardClient";
import { DEFAULT_PAGE_SIZE, getPaginatedJobs } from "@/lib/jobs-query";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [
    initialJobsPage,
    sources,
    totalJobs,
    newJobs,
    savedJobs,
    appliedJobs,
    skippedJobs,
    sponsorYesJobs,
    sponsorNoJobs,
    sponsorUnknownJobs,
    lastSyncRun,
  ] = await Promise.all([
    getPaginatedJobs({ page: 1, pageSize: DEFAULT_PAGE_SIZE, active: "true" }),
    prisma.jobSource.findMany({
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    }),
    prisma.job.count(),
    prisma.job.count({ where: { status: "NEW" } }),
    prisma.job.count({ where: { status: "SAVED" } }),
    prisma.job.count({ where: { status: "APPLIED" } }),
    prisma.job.count({ where: { status: "SKIPPED" } }),
    prisma.job.count({ where: { sponsorship: "YES" } }),
    prisma.job.count({ where: { sponsorship: "NO" } }),
    prisma.job.count({ where: { sponsorship: "UNKNOWN" } }),
    prisma.syncRun.findFirst({
      include: {
        sourceRuns: {
          where: { status: "FAILED" },
          orderBy: { startedAt: "asc" },
          take: 10,
        },
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  return (
    <JobBoardClient
      initialJobs={initialJobsPage.jobs}
      initialPage={initialJobsPage.page}
      initialPageSize={initialJobsPage.pageSize}
      initialStats={{
        Total: totalJobs,
        New: newJobs,
        Saved: savedJobs,
        Applied: appliedJobs,
        Skipped: skippedJobs,
        "Sponsor Yes": sponsorYesJobs,
        "Sponsor No": sponsorNoJobs,
        Unknown: sponsorUnknownJobs,
      }}
      initialTotal={initialJobsPage.total}
      initialTotalPages={initialJobsPage.totalPages}
      lastSyncRun={
        lastSyncRun
          ? {
              id: lastSyncRun.id,
              status: lastSyncRun.status,
              startedAt: lastSyncRun.startedAt.toISOString(),
              finishedAt: lastSyncRun.finishedAt?.toISOString() ?? null,
              sourcesProcessed: lastSyncRun.sourcesProcessed,
              sourcesSucceeded: lastSyncRun.sourcesSucceeded,
              sourcesFailed: lastSyncRun.sourcesFailed,
              jobsCreated: lastSyncRun.jobsCreated,
              jobsUpdated: lastSyncRun.jobsUpdated,
              jobsMarkedStale: lastSyncRun.jobsMarkedStale,
              errorSummary: lastSyncRun.errorSummary,
              failedSources: lastSyncRun.sourceRuns.map((sourceRun) => ({
                id: sourceRun.id,
                company: sourceRun.company,
                provider: sourceRun.provider,
                errorMessage: sourceRun.errorMessage,
              })),
            }
          : null
      }
      sourceSummary={sources.map((source) => ({
        id: source.id,
        company: source.company,
        provider: source.provider,
        enabled: source.enabled,
        lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: source.lastSyncStatus,
      }))}
    />
  );
}
