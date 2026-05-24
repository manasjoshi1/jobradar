/**
 * POST /api/cron/hourly
 *
 * Requires header: Authorization: Bearer <CRON_SECRET>
 *
 * Runs sync + recommendation in sequence.
 * Can be triggered externally (Vercel cron, cron job, etc.)
 * or manually for testing.
 */
import { NextResponse, type NextRequest } from "next/server";
import { runRecommendations } from "@/lib/services/recommendation-service";

export const dynamic = "force-dynamic";

// Import the sync function from the sync route's logic
// We call it directly so we avoid HTTP round-trips
async function runSync() {
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
  const errors: string[] = [];

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

      // Mark stale
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
      errors.push(`${source.company}: ${msg}`);
    }
  }

  const status = sourcesFailed === 0 ? "SUCCESS" : sourcesSucceeded === 0 ? "FAILED" : "PARTIAL_FAILURE";
  await prisma.syncRun.update({
    where: { id: syncRun.id },
    data: {
      finishedAt: new Date(),
      status,
      sourcesSucceeded,
      sourcesFailed,
      jobsCreated,
      jobsUpdated,
      jobsMarkedStale,
      errorSummary: errors.length ? errors.slice(0, 10).join("\n").slice(0, 2000) : null,
    },
  });

  return { sourcesProcessed: sources.length, sourcesSucceeded, sourcesFailed, jobsCreated, jobsUpdated, jobsMarkedStale };
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    console.log("[cron/hourly] Starting hourly sync + recommendations");
    const syncResult = await runSync();
    console.log("[cron/hourly] Sync complete:", syncResult);

    const recResult = await runRecommendations(1);
    console.log("[cron/hourly] Recommendations complete:", recResult);

    return NextResponse.json({
      sync: syncResult,
      recommendations: recResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron run failed";
    console.error("[cron/hourly] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
