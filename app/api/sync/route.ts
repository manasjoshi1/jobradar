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
    errors: [],
  };

  for (const source of sources) {
    try {
      const jobs = await fetchJobsFromSource(source);

      for (const job of jobs) {
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
        } else {
          summary.jobsCreated += 1;
        }
      }

      await prisma.jobSource.update({
        where: { id: source.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: `OK: ${jobs.length} jobs`,
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

      summary.sourcesFailed += 1;
      summary.errors.push({
        sourceId: source.id,
        company: source.company,
        provider: source.provider,
        message,
      });
    }
  }

  return NextResponse.json(summary);
}
