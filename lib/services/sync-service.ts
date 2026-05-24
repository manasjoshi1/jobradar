/**
 * Shared sync service used by both the scheduler and the API route.
 * Parallelises source fetching with p-limit, serialises SQLite writes,
 * adds per-source timeout + retry, and batch-reads existing jobs to
 * avoid one DB query per job.
 *
 * Env vars (all optional with safe defaults):
 *   SYNC_FETCH_CONCURRENCY   — parallel HTTP fetches        (default: 8)
 *   SYNC_DB_CONCURRENCY      — parallel SQLite write slots  (default: 1)
 *   SOURCE_FETCH_TIMEOUT_MS  — per-source HTTP timeout ms   (default: 15000)
 *   SOURCE_FETCH_RETRIES     — retry count on timeout/error (default: 1)
 *   DEBUG_SYNC               — log per-source timing        (default: false)
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { fetchJobsFromSource } from "@/lib/providers";
import { detectSponsorship } from "@/lib/sponsorship";
import type { JobSource } from "@prisma/client";
import type { NormalizedJob } from "@/lib/types";

// ── Config ────────────────────────────────────────────────────────────────────
const FETCH_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SYNC_FETCH_CONCURRENCY ?? "8", 10) || 8,
);
const DB_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SYNC_DB_CONCURRENCY ?? "1", 10) || 1,
);
const FETCH_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.SOURCE_FETCH_TIMEOUT_MS ?? "15000", 10) || 15000,
);
const FETCH_RETRIES = Math.max(
  0,
  parseInt(process.env.SOURCE_FETCH_RETRIES ?? "1", 10) || 1,
);
const DEBUG_SYNC = process.env.DEBUG_SYNC === "true";

function debugLog(...args: unknown[]) {
  if (DEBUG_SYNC) console.log("[sync-service]", ...args);
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type SyncError = {
  sourceId: string;
  company: string;
  provider: string;
  message: string;
};

export type SyncResult = {
  syncRunId: string;
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsMarkedStale: number;
  durationMs: number;
  errors: SyncError[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch with hard timeout via Promise.race; retries up to `retries` times. */
async function fetchWithRetry(
  source: JobSource,
  retries: number,
  timeoutMs: number,
): Promise<NormalizedJob[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Promise.race enforces a hard deadline even if the provider's fetch
      // does not accept an AbortSignal. The underlying connection is abandoned
      // (the provider has no handle to cancel it), but we stop waiting and
      // move on — critical for keeping concurrency meaningful.
      const result = await Promise.race([
        fetchJobsFromSource(source),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Source timeout after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        debugLog(`Retry ${attempt + 1}/${retries} for ${source.company}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  throw lastError;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// ── Core per-source sync ──────────────────────────────────────────────────────

/**
 * Syncs one source end-to-end.
 * Uses a batch read of existing jobs to avoid N+1 DB queries.
 */
async function syncSource(
  source: JobSource,
  syncRunId: string,
  dbLimit: ReturnType<typeof pLimit>,
): Promise<{ created: number; updated: number; stale: number }> {
  const t0 = Date.now();

  const sourceRun = await dbLimit(() =>
    prisma.syncSourceRun.create({
      data: {
        syncRunId,
        sourceId: source.id,
        company: source.company,
        provider: source.provider,
        status: "SKIPPED",
      },
    }),
  );

  let jobs: NormalizedJob[];
  try {
    jobs = await fetchWithRetry(source, FETCH_RETRIES, FETCH_TIMEOUT_MS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await dbLimit(() =>
      Promise.all([
        prisma.jobSource.update({
          where: { id: source.id },
          data: { lastSyncAt: new Date(), lastSyncStatus: `ERROR: ${msg.slice(0, 240)}` },
        }),
        prisma.syncSourceRun.update({
          where: { id: sourceRun.id },
          data: { status: "FAILED", errorMessage: truncate(msg, 1000), finishedAt: new Date() },
        }),
      ]),
    );
    throw err;
  }

  debugLog(`Fetched ${jobs.length} jobs from ${source.company} in ${Date.now() - t0}ms`);

  // Batch-read all existing jobs for this source in one query
  const existingJobs = await dbLimit(() =>
    prisma.job.findMany({
      where: { sourceId: source.id },
      select: { applyUrl: true, postedAt: true, effectiveNewAt: true, firstSeenAt: true },
    }),
  );
  const existingMap = new Map(existingJobs.map((j) => [j.applyUrl, j]));

  const now = new Date();
  const seenUrls = new Set<string>();
  let created = 0;
  let updated = 0;

  // Write jobs through the DB limiter (serialised for SQLite safety)
  for (const job of jobs) {
    seenUrls.add(job.applyUrl);
    const existing = existingMap.get(job.applyUrl);
    const postedAt = job.postedAt ? new Date(job.postedAt) : null;
    const effectiveNewAt = postedAt ?? now;
    const needEffectiveUpdate = postedAt && existing && !existing.postedAt;

    const sponsorship = detectSponsorship(
      [job.title, job.description, job.location, job.department]
        .filter(Boolean)
        .join(" "),
    );

    await dbLimit(() =>
      prisma.job.upsert({
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
      }),
    );

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  // Mark jobs no longer in feed as stale
  const staleResult = await dbLimit(() =>
    seenUrls.size > 0
      ? prisma.job.updateMany({
          where: { sourceId: source.id, applyUrl: { notIn: [...seenUrls] }, isActive: true },
          data: { isActive: false },
        })
      : prisma.job.updateMany({
          where: { sourceId: source.id, isActive: true },
          data: { isActive: false },
        }),
  );

  await dbLimit(() =>
    Promise.all([
      prisma.jobSource.update({
        where: { id: source.id },
        data: { lastSyncAt: now, lastSyncStatus: `OK: ${jobs.length} jobs` },
      }),
      prisma.syncSourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status: "SUCCESS",
          jobsFetched: jobs.length,
          jobsCreated: created,
          jobsUpdated: updated,
          finishedAt: new Date(),
        },
      }),
    ]),
  );

  debugLog(
    `${source.company}: ${created} created, ${updated} updated, ${staleResult.count} stale — ${Date.now() - t0}ms total`,
  );

  return { created, updated, stale: staleResult.count };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Runs a full sync cycle.
 * Returns a SyncResult once all sources are done.
 *
 * Pass an existing syncRunId to append to an in-progress run (used by
 * the background /api/sync/start flow). If omitted, a new SyncRun is
 * created and finalised here.
 */
export async function runSync(existingSyncRunId?: string): Promise<SyncResult> {
  const startMs = Date.now();

  // Check if any user has UserJobSource preferences
  const userSourceCount = await prisma.userJobSource.count();
  let sources: JobSource[];
  if (userSourceCount > 0) {
    // At least one user has source preferences — sync only user-selected enabled sources
    const userSourceIds = await prisma.userJobSource.findMany({
      where: { enabled: true },
      select: { sourceId: true },
      distinct: ["sourceId"],
    });
    const sourceIdSet = new Set(userSourceIds.map((u) => u.sourceId));
    sources = await prisma.jobSource.findMany({
      where: { enabled: true, id: { in: [...sourceIdSet] } },
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    });
  } else {
    // Fallback: sync all enabled global sources
    sources = await prisma.jobSource.findMany({
      where: { enabled: true },
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    });
  }

  const syncRunId =
    existingSyncRunId ??
    (
      await prisma.syncRun.create({
        data: { status: "RUNNING", sourcesProcessed: sources.length },
      })
    ).id;

  // Always write the real source count upfront so polling shows progress
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: { sourcesProcessed: sources.length },
  });

  console.log(
    `[sync-service] Starting sync — ${sources.length} sources, fetchConcurrency=${FETCH_CONCURRENCY}, dbConcurrency=${DB_CONCURRENCY}, timeout=${FETCH_TIMEOUT_MS}ms, retries=${FETCH_RETRIES}`,
  );

  const fetchLimit = pLimit(FETCH_CONCURRENCY);
  const dbLimit = pLimit(DB_CONCURRENCY);

  let sourcesSucceeded = 0;
  let sourcesFailed = 0;
  let jobsCreated = 0;
  let jobsUpdated = 0;
  let jobsMarkedStale = 0;
  const errors: SyncError[] = [];

  // Run all sources in parallel (bounded by FETCH_CONCURRENCY)
  // After each source completes, atomically increment the counters in DB for live polling.
  const results = await Promise.allSettled(
    sources.map((source) =>
      fetchLimit(async () => {
        try {
          const r = await syncSource(source, syncRunId, dbLimit);
          // Increment progress counters in DB (inside dbLimit to serialise writes)
          await dbLimit(() =>
            prisma.$executeRaw`
              UPDATE "SyncRun"
              SET sourcesSucceeded = sourcesSucceeded + 1,
                  jobsCreated      = jobsCreated      + ${r.created},
                  jobsUpdated      = jobsUpdated      + ${r.updated},
                  jobsMarkedStale  = jobsMarkedStale  + ${r.stale}
              WHERE id = ${syncRunId}
            `,
          );
          return { source, ...r };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({
            sourceId: source.id,
            company: source.company,
            provider: source.provider,
            message,
          });
          // Increment failure counter
          await dbLimit(() =>
            prisma.$executeRaw`
              UPDATE "SyncRun" SET sourcesFailed = sourcesFailed + 1 WHERE id = ${syncRunId}
            `,
          ).catch(() => {});
          throw err;
        }
      }),
    ),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      sourcesSucceeded++;
      jobsCreated += r.value.created;
      jobsUpdated += r.value.updated;
      jobsMarkedStale += r.value.stale;
    } else {
      sourcesFailed++;
    }
  }

  const syncStatus =
    sourcesFailed === 0
      ? "SUCCESS"
      : sourcesSucceeded === 0
        ? "FAILED"
        : "PARTIAL_FAILURE";

  const durationMs = Date.now() - startMs;

  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      finishedAt: new Date(),
      status: syncStatus,
      sourcesProcessed: sources.length,
      sourcesSucceeded,
      sourcesFailed,
      jobsCreated,
      jobsUpdated,
      jobsMarkedStale,
      errorSummary: errors.length
        ? truncate(
            errors
              .slice(0, 10)
              .map((e) => `${e.company}: ${e.message}`)
              .join("\n"),
            2000,
          )
        : null,
    },
  });

  console.log(
    `[sync-service] Done in ${(durationMs / 1000).toFixed(1)}s — created=${jobsCreated} updated=${jobsUpdated} stale=${jobsMarkedStale} failed=${sourcesFailed}/${sources.length}`,
  );

  return {
    syncRunId,
    sourcesProcessed: sources.length,
    sourcesSucceeded,
    sourcesFailed,
    jobsCreated,
    jobsUpdated,
    jobsMarkedStale,
    durationMs,
    errors,
  };
}
