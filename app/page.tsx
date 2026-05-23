import { JobBoard } from "@/components/job-board";
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
  ] = await Promise.all([
    prisma.job.findMany({
      take: JOBS_TO_LOAD,
      select: {
        id: true,
        company: true,
        title: true,
        location: true,
        department: true,
        description: true,
        applyUrl: true,
        postedAt: true,
        firstSeenAt: true,
        lastSeenAt: true,
        status: true,
        sponsorship: true,
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
  ]);

  return (
    <JobBoard
      jobs={jobs.map((job) => ({
        id: job.id,
        company: job.company,
        title: job.title,
        location: job.location,
        department: job.department,
        provider: job.source.provider,
        description: job.description,
        applyUrl: job.applyUrl,
        postedAt: job.postedAt?.toISOString() ?? null,
        firstSeenAt: job.firstSeenAt.toISOString(),
        lastSeenAt: job.lastSeenAt.toISOString(),
        status: job.status as JobStatus,
        sponsorship: job.sponsorship as Sponsorship,
      }))}
      stats={{
        Total: totalJobs,
        New: newJobs,
        Saved: savedJobs,
        Applied: appliedJobs,
        Skipped: skippedJobs,
        "Sponsor Yes": sponsorYesJobs,
        "Sponsor No": sponsorNoJobs,
        Unknown: sponsorUnknownJobs,
      }}
      sources={sources.map((source) => ({
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
