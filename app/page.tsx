import { JobBoard } from "@/components/job-board";
import { prisma } from "@/lib/prisma";
import type { JobStatus, Sponsorship } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [jobs, sources] = await Promise.all([
    prisma.job.findMany({
      include: {
        source: {
          select: {
            provider: true,
          },
        },
      },
      orderBy: [{ lastSeenAt: "desc" }],
    }),
    prisma.jobSource.findMany({
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    }),
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
      sources={sources.map((source) => ({
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
