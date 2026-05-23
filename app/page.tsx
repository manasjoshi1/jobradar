import { JobBoardClient } from "@/components/JobBoardClient";
import { prisma } from "@/lib/prisma";
import type { JobStatus, Sponsorship } from "@/lib/types";

export const dynamic = "force-dynamic";
const JOBS_TO_LOAD = 1_000;

export default async function Home() {
  const [
    jobs,
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
    prisma.job.findMany({
      take: JOBS_TO_LOAD,
      select: {
        id: true,
        company: true,
        title: true,
        location: true,
        department: true,
        employmentType: true,
        description: true,
        applyUrl: true,
        postedAt: true,
        firstSeenAt: true,
        lastSeenAt: true,
        status: true,
        sponsorship: true,
        isActive: true,
        source: {
          select: {
            provider: true,
          },
        },
      },
      orderBy: [{ lastSeenAt: "desc" }, { postedAt: "desc" }],
    }),
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
      initialJobs={jobs.map((job) => ({
        id: job.id,
        company: job.company,
        title: job.title,
        location: job.location,
        department: job.department,
        employmentType: job.employmentType,
        provider: job.source.provider,
        description: job.description,
        applyUrl: job.applyUrl,
        postedAt: job.postedAt?.toISOString() ?? null,
        firstSeenAt: job.firstSeenAt.toISOString(),
        lastSeenAt: job.lastSeenAt.toISOString(),
        status: job.status as JobStatus,
        sponsorship: job.sponsorship as Sponsorship,
        isActive: job.isActive,
      }))}
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
      totalJobCount={totalJobs}
    />
  );
}
