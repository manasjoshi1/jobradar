/**
 * lib/services/workday-maintenance-service.ts
 *
 * Periodic Workday lifecycle maintenance — runs on the scheduler (hourly).
 *
 * What it does (separate from the normal job sync):
 *   - Re-probes each Workday source's CXS endpoint (cheap: limit=1 POST)
 *   - Re-classifies via the shared lifecycle rules
 *   - Persists verificationStatus / fetchStrategy / nextRetryAt / metadata
 *
 * Why it's separate from runSync():
 *   - The normal sync only fetches api_valid / scraper-eligible sources. Failed
 *     sources (wrong_site_slug, auth_blocked, host_dead, …) are excluded so they
 *     are never hammered. This maintenance pass is the controlled place where
 *     those are periodically re-checked so the lifecycle is self-healing:
 *       • a temporarily-down host (5xx/timeout) recovers → api_valid
 *       • a fixed slug or re-pointed tenant recovers → api_valid (re-enabled)
 *       • a newly-broken source is demoted out of the sync path
 *
 * Respects:
 *   - manuallyDisabled (never re-enabled here)
 *   - nextRetryAt backoff for temporary_failure (skipped until due) unless forced
 */

import { prisma } from "@/lib/prisma";
import {
  classifyWorkdayFailure,
  buildWorkdaySourceUpdate,
  parseWorkdayMeta,
  type WorkdayVerificationStatus,
} from "@/lib/workday/lifecycle";
import { scrapeWorkdaySource, WORKDAY_SCRAPER_ENABLED } from "@/lib/workday/scraper";

const PROBE_TIMEOUT_MS = 12_000;
const CONCURRENCY = Math.max(
  1,
  parseInt(process.env.WORKDAY_MAINTENANCE_CONCURRENCY ?? "4", 10) || 4,
);

export type WorkdayMaintenanceResult = {
  checked:    number;
  skipped:    number;   // in backoff, not yet due
  recovered:  number;   // failed → api_valid
  regressed:  number;   // api_valid → some failure
  byStatus:   Record<string, number>;
  durationMs: number;
};

type ProbeOutcome = {
  httpStatus: number | null;
  body:       unknown;
  error:      Error | null;
};

/** Cheap CXS probe — POST limit=1. Never throws. */
async function probe(url: string): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "JobRadarMaintenance/1.0" },
      body:    JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal:  controller.signal,
    });
    if (!res.ok) return { httpStatus: res.status, body: {}, error: null };
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return { httpStatus: 200, body: {}, error: null };
    try {
      return { httpStatus: 200, body: JSON.parse(text), error: null };
    } catch {
      return { httpStatus: 200, body: {}, error: null };
    }
  } catch (err) {
    return { httpStatus: null, body: null, error: err instanceof Error ? err : new Error(String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a maintenance pass over all Workday sources.
 *
 * @param opts.force  re-check even sources whose nextRetryAt is in the future
 */
export async function runWorkdayMaintenance(
  opts: { force?: boolean } = {},
): Promise<WorkdayMaintenanceResult> {
  const t0  = Date.now();
  const now = new Date();

  const sources = await prisma.jobSource.findMany({
    where:  { provider: "WORKDAY" },
    select: { id: true, company: true, url: true, enabled: true, metadata: true, verificationStatus: true, nextRetryAt: true },
  });

  const byStatus: Record<string, number> = {};
  let checked = 0, skipped = 0, recovered = 0, regressed = 0;

  // Process in bounded batches
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (s) => {
        const meta = parseWorkdayMeta(s);

        // Never touch manually disabled sources
        if (meta.manuallyDisabled) { skipped++; return; }

        // Respect backoff unless forced
        if (!opts.force && s.nextRetryAt && s.nextRetryAt.getTime() > now.getTime()) {
          skipped++;
          return;
        }

        const prevStatus = (s.verificationStatus ?? "unverified") as WorkdayVerificationStatus;
        const outcome = await probe(s.url);

        const classification = classifyWorkdayFailure({
          httpStatus:   outcome.httpStatus,
          body:         outcome.body,
          error:        outcome.error ?? undefined,
          failureCount: meta.consecutiveFailureCount,
          highPriority: meta.highPriority,
        });

        const update = buildWorkdaySourceUpdate(s, classification, {
          httpStatus: outcome.httpStatus,
          lastError:  outcome.error?.message ?? null,
        });

        await prisma.jobSource.update({ where: { id: s.id }, data: update }).catch((e) =>
          console.warn(`[workday-maintenance] update failed for ${s.company}:`, e),
        );

        checked++;
        const newStatus = classification.verificationStatus;
        byStatus[newStatus] = (byStatus[newStatus] ?? 0) + 1;

        if (newStatus === "api_valid" && prevStatus !== "api_valid" && prevStatus !== "unverified") recovered++;
        if (newStatus !== "api_valid" && prevStatus === "api_valid") regressed++;
      }),
    );
  }

  const result: WorkdayMaintenanceResult = {
    checked, skipped, recovered, regressed, byStatus, durationMs: Date.now() - t0,
  };

  console.log(
    `[workday-maintenance] checked=${checked} skipped=${skipped} ` +
    `recovered=${recovered} regressed=${regressed} (${(result.durationMs / 1000).toFixed(1)}s)`,
  );

  return result;
}

// ── Scraper-candidate validation ──────────────────────────────────────────────

export type ScraperValidationResult = {
  attempted:     number;
  promotedApi:   number;   // candidate → api_valid (CXS discovered by browser)
  promotedScrape: number;  // candidate → scraper_valid (DOM)
  blocked:       number;   // candidate → browser_required
  stillCandidate: number;
  durationMs:    number;
};

/**
 * Activate Workday scraper candidates so they actually start producing jobs.
 *
 * The promote script intentionally leaves candidates `enabled=false` — they must
 * pass a real browser run first. This pass does that validation:
 *   - api_discovered → the browser found a working CXS endpoint: switch the
 *     source back to API mode (api_valid, enabled) — this RECOVERS wrong_site_slug
 *     sources by finding their real endpoint.
 *   - dom jobs found → scraper_valid + enabled (regular sync will scrape it).
 *   - blocked (captcha/auth) → browser_required, stays disabled, no retry storm.
 *   - empty → stays a candidate, retried next pass.
 *
 * Gated by WORKDAY_SCRAPER_ENABLED. Bounded by `limit` to cap Chromium time.
 * The scraper module enforces single-browser concurrency internally.
 */
export async function validateScraperCandidates(
  opts: { limit?: number } = {},
): Promise<ScraperValidationResult> {
  const t0 = Date.now();
  const limit = Math.max(1, opts.limit ?? 5);

  const base: ScraperValidationResult = {
    attempted: 0, promotedApi: 0, promotedScrape: 0, blocked: 0, stillCandidate: 0,
    durationMs: 0,
  };

  if (!WORKDAY_SCRAPER_ENABLED) {
    console.log("[workday-scraper-validation] Skipped — WORKDAY_SCRAPER_ENABLED != true");
    return { ...base, durationMs: Date.now() - t0 };
  }

  const candidates = await prisma.jobSource.findMany({
    where:  { provider: "WORKDAY", verificationStatus: "scraper_candidate" },
    select: { id: true, company: true, url: true, metadata: true, enabled: true },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
    take:   limit,
  });

  for (const s of candidates) {
    const meta = parseWorkdayMeta(s);
    if (meta.manuallyDisabled) continue;

    base.attempted++;
    const now = new Date();
    const result = await scrapeWorkdaySource({ company: s.company, url: s.url });

    if (result.mode === "api_discovered" && result.discovery) {
      const apiUrl   = result.discovery.apiUrl;
      const existing = await prisma.jobSource.findUnique({ where: { url: apiUrl } }).catch(() => null);
      const updateUrl = !existing || existing.id === s.id;
      await prisma.jobSource.update({
        where: { id: s.id },
        data: {
          ...(updateUrl ? { url: apiUrl } : {}),
          enabled: true, verificationStatus: "api_valid", fetchStrategy: "API", nextRetryAt: null,
          metadata: JSON.stringify({ workday: {
            ...meta, verificationStatus: "api_valid", fetchStrategy: "API",
            lastStatusCode: 200, lastVerifiedAt: now.toISOString(), lastSuccessfulSyncAt: now.toISOString(),
            failureCount: 0, consecutiveFailureCount: 0, lastError: null, lastJobCount: result.jobs.length,
          } }),
          lastSyncAt: now, lastSyncStatus: `OK: CXS discovered via browser (${result.discovery.total} total)`,
        },
      }).catch((e) => console.warn(`[workday-scraper-validation] ${s.company} api-promote failed:`, e));
      base.promotedApi++;
    } else if (result.mode === "dom" && result.jobs.length > 0) {
      await prisma.jobSource.update({
        where: { id: s.id },
        data: {
          enabled: true, verificationStatus: "scraper_valid", fetchStrategy: "SCRAPER", nextRetryAt: null,
          metadata: JSON.stringify({ workday: {
            ...meta, verificationStatus: "scraper_valid", fetchStrategy: "SCRAPER",
            lastVerifiedAt: now.toISOString(), lastSuccessfulSyncAt: now.toISOString(),
            failureCount: 0, consecutiveFailureCount: 0, lastError: null, lastJobCount: result.jobs.length,
          } }),
          lastSyncAt: now, lastSyncStatus: `OK: scraped ${result.jobs.length} jobs (DOM)`,
        },
      }).catch((e) => console.warn(`[workday-scraper-validation] ${s.company} scrape-promote failed:`, e));
      base.promotedScrape++;
    } else if (result.mode === "blocked") {
      await prisma.jobSource.update({
        where: { id: s.id },
        data: {
          enabled: false, verificationStatus: "browser_required", fetchStrategy: "DISABLED",
          metadata: JSON.stringify({ workday: {
            ...meta, verificationStatus: "browser_required", fetchStrategy: "DISABLED",
            lastVerifiedAt: now.toISOString(), lastFailedSyncAt: now.toISOString(),
            lastError: `scraper blocked: ${result.blockReason ?? "unknown"}`,
          } }),
          lastSyncAt: now, lastSyncStatus: `browser_required: ${result.blockReason ?? "blocked"}`,
        },
      }).catch((e) => console.warn(`[workday-scraper-validation] ${s.company} block-demote failed:`, e));
      base.blocked++;
    } else {
      // empty — keep as candidate, stamp lastVerifiedAt so we retry later
      await prisma.jobSource.update({
        where: { id: s.id },
        data: { metadata: JSON.stringify({ workday: { ...meta, lastVerifiedAt: now.toISOString(), lastJobCount: 0 } }) },
      }).catch(() => {});
      base.stillCandidate++;
    }
  }

  const out = { ...base, durationMs: Date.now() - t0 };
  console.log(
    `[workday-scraper-validation] attempted=${out.attempted} → api=${out.promotedApi} ` +
    `scrape=${out.promotedScrape} blocked=${out.blocked} pending=${out.stillCandidate} ` +
    `(${(out.durationMs / 1000).toFixed(1)}s)`,
  );
  return out;
}
