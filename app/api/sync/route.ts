import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchJobsFromSource } from "@/lib/providers";
import { detectSponsorship } from "@/lib/sponsorship";

export const dynamic = "force-dynamic";

type SyncError = {
  sourceId: string;
  company: string;
  provider: string;
  message: string;
};

type SyncSummary = {
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsMarkedStale: number;
  errors: SyncError[];
};

export async function GET() {
  return syncJobs();
}

export async function POST() {
  return syncJobs();
}

async function syncJobs() {
  const sources = await prisma.jobSource.findMany({
    where: { enabled: true },
    orderBy: [{ provider: "asc" }, { company: "asc" }],
  });

  const summary: SyncSummary = {
    sourcesProcessed: sources.length,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    jobsCreated: 0,
    jobsUpdated: 0,
    jobsMarkedStale: 0,
    errors: [],
  };
  const syncRun = await prisma.syncRun.create({
    data: {
      status: "RUNNING",
      sourcesProcessed: sources.length,
    },
  });

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
      let sourceJobsCreated = 0;
      let sourceJobsUpdated = 0;
      const seenApplyUrls = new Set<string>();

      for (const job of jobs) {
        seenApplyUrls.add(job.applyUrl);
        const existing = await prisma.job.findUnique({
          where: {
            sourceId_applyUrl: {
              sourceId: source.id,
              applyUrl: job.applyUrl,
            },
          },
          select: { id: true },
        });

        const sponsorship = detectSponsorship(
          [job.title, job.description, job.location, job.department]
            .filter(Boolean)
            .join(" "),
        );
        const now = new Date();

        await prisma.job.upsert({
          where: {
            sourceId_applyUrl: {
              sourceId: source.id,
              applyUrl: job.applyUrl,
            },
          },
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
            postedAt: job.postedAt ? new Date(job.postedAt) : null,
            sponsorship,
            status: "NEW",
            firstSeenAt: now,
            lastSeenAt: now,
            isActive: true,
          },
          // User status must survive re-sync. Do not update status or firstSeenAt here.
          update: {
            externalId: job.externalId || null,
            company: job.company,
            title: job.title,
            location: job.location || null,
            department: job.department || null,
            employmentType: job.employmentType || null,
            description: job.description || null,
            postedAt: job.postedAt ? new Date(job.postedAt) : null,
            sponsorship,
            lastSeenAt: now,
            isActive: true,
          },
        });

        if (existing) {
          summary.jobsUpdated += 1;
          sourceJobsUpdated += 1;
        } else {
          summary.jobsCreated += 1;
          sourceJobsCreated += 1;
        }
      }

      const staleResult =
        seenApplyUrls.size > 0
          ? await prisma.job.updateMany({
              where: {
                sourceId: source.id,
                applyUrl: { notIn: [...seenApplyUrls] },
                isActive: true,
              },
              data: { isActive: false },
            })
          : await prisma.job.updateMany({
              where: {
                sourceId: source.id,
                isActive: true,
              },
              data: { isActive: false },
            });
      summary.jobsMarkedStale += staleResult.count;

      await prisma.jobSource.update({
        where: { id: source.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: `OK: ${jobs.length} jobs`,
        },
      });
      await prisma.syncSourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status: "SUCCESS",
          jobsFetched: jobs.length,
          jobsCreated: sourceJobsCreated,
          jobsUpdated: sourceJobsUpdated,
          finishedAt: new Date(),
        },
      });

      summary.sourcesSucceeded += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown source sync error";

      await prisma.jobSource.update({
        where: { id: source.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: `ERROR: ${message.slice(0, 240)}`,
        },
      });
      await prisma.syncSourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status: "FAILED",
          errorMessage: truncate(message, 1_000),
          finishedAt: new Date(),
        },
      });

      summary.sourcesFailed += 1;
      summary.errors.push({
        sourceId: source.id,
        company: source.company,
        provider: source.provider,
        message,
      });
    }
  }

  const status =
    summary.sourcesFailed === 0
      ? "SUCCESS"
      : summary.sourcesSucceeded === 0
        ? "FAILED"
        : "PARTIAL_FAILURE";

  await prisma.syncRun.update({
    where: { id: syncRun.id },
    data: {
      finishedAt: new Date(),
      status,
      sourcesProcessed: summary.sourcesProcessed,
      sourcesSucceeded: summary.sourcesSucceeded,
      sourcesFailed: summary.sourcesFailed,
      jobsCreated: summary.jobsCreated,
      jobsUpdated: summary.jobsUpdated,
      jobsMarkedStale: summary.jobsMarkedStale,
      errorSummary: summary.errors.length
        ? truncate(
            summary.errors
              .slice(0, 10)
              .map((error) => `${error.company}: ${error.message}`)
              .join("\n"),
            2_000,
          )
        : null,
    },
  });

  return NextResponse.json(summary);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
