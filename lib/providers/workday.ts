/**
 * lib/providers/workday.ts
 *
 * Fetches jobs from Workday. Entry point `fetchJobsFromWorkday` dispatches by
 * the source's fetchStrategy:
 *
 *   API / null / AUTO(api_valid)  → CXS JSON API (fetchWorkdayApiJobs)
 *   SCRAPER / AUTO(scraper_*)     → Playwright scraper (fetchWorkdayScrapedJobs)
 *
 * The API path:
 *   - "Latest jobs only": up to WORKDAY_MAX_PAGES pages, stops at jobs older
 *     than WORKDAY_MAX_AGE_DAYS, or when offset >= total.
 *   - Classifies every failure; persists lifecycle state asynchronously.
 *   - Permanent failures (422/401/403/404) return [] silently.
 *   - Temporary failures (5xx/timeout) re-throw → sync-service applies backoff.
 *
 * The scraper path (opt-in, WORKDAY_SCRAPER_ENABLED=true):
 *   - Discovers the CXS endpoint via browser network capture; if directly
 *     POST-able, promotes the source back to API mode.
 *   - Otherwise scrapes the DOM.
 *   - CAPTCHA/auth walls → browser_required, no hourly retry.
 *
 * Env vars:
 *   WORKDAY_MAX_PAGES    (5)   WORKDAY_PAGE_SIZE (20)   WORKDAY_MAX_AGE_DAYS (14)
 *   WORKDAY_SCRAPER_ENABLED (false)
 */

import type { JobSource } from "@prisma/client";
import type { NormalizedJob } from "../types";
import { prisma } from "../prisma";
import {
  classifyWorkdayFailure,
  buildWorkdaySourceUpdate,
  parseWorkdayMeta,
  isScraperEligible,
} from "../workday/lifecycle";
import {
  parseWorkdayPostedOn,
  isWithinDays,
  normalizeWorkdayApiJob,
  parseCxsUrl,
} from "../workday/parse";
import {
  scrapeWorkdaySource,
  WORKDAY_SCRAPER_ENABLED,
} from "../workday/scraper";

const FETCH_TIMEOUT_MS = Math.max(
  5_000,
  parseInt(process.env.SOURCE_FETCH_TIMEOUT_MS ?? "20000", 10) || 20_000,
);
const MAX_PAGES    = Math.max(1, parseInt(process.env.WORKDAY_MAX_PAGES    ?? "5",  10) || 5);
const PAGE_SIZE    = Math.min(20, Math.max(1, parseInt(process.env.WORKDAY_PAGE_SIZE ?? "20", 10) || 20));
const MAX_AGE_DAYS = Math.max(1, parseInt(process.env.WORKDAY_MAX_AGE_DAYS ?? "14", 10) || 14);

// Re-export for backward compatibility (existing imports / tests)
export { parseWorkdayPostedOn };

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkdayResponse = {
  total?:       number;
  jobPostings?: Array<Record<string, unknown>>;
};

// ── CXS page fetch ──────────────────────────────────────────────────────────

/** POST one page. Returns { status, body }; never throws on HTTP errors. */
async function fetchWorkdayPage(
  apiUrl: string,
  offset: number,
  limit: number,
): Promise<{ status: number; body: WorkdayResponse }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Accept:          "application/json",
        "User-Agent":    "JobRadarMVP/0.1 (+https://local.jobradar)",
      },
      body:   JSON.stringify({ appliedFacets: {}, limit, offset, searchText: "" }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: res.status, body: {} };

    let body: WorkdayResponse = {};
    try {
      const text = await res.text();
      if (text.trimStart().startsWith("<")) return { status: 200, body: {} }; // HTML → invalid_schema
      body = JSON.parse(text) as WorkdayResponse;
    } catch { /* JSON parse error → invalid_schema */ }
    return { status: 200, body };
  } finally {
    clearTimeout(timer);
  }
}

// ── API fetcher ───────────────────────────────────────────────────────────────

async function fetchWorkdayApiJobs(source: JobSource): Promise<NormalizedJob[]> {
  const meta = parseWorkdayMeta(source);
  const jobs: NormalizedJob[] = [];
  let lastStatus: number | null = null;
  let lastBody: unknown         = null;
  let fetchError: Error | null  = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;

      let pageResult: { status: number; body: WorkdayResponse };
      try {
        pageResult = await fetchWorkdayPage(source.url, offset, PAGE_SIZE);
      } catch (err) {
        fetchError = err instanceof Error ? err : new Error(String(err));
        break;
      }

      lastStatus = pageResult.status;
      lastBody   = pageResult.body;
      if (lastStatus !== 200) break;

      const total    = Number(pageResult.body.total);
      const postings = pageResult.body.jobPostings ?? [];
      if (postings.length === 0) break;

      let pageHasRecent = false;
      for (const posting of postings) {
        const postedAt = parseWorkdayPostedOn(posting.postedOn as string | undefined);
        if (isWithinDays(postedAt, MAX_AGE_DAYS)) pageHasRecent = true;

        const job = normalizeWorkdayApiJob(posting, source);
        if (job) jobs.push(job);
      }

      // Stop conditions
      if (!pageHasRecent) break;                      // entire page is stale
      if (postings.length < PAGE_SIZE) break;         // last page
      if (Number.isFinite(total) && offset + PAGE_SIZE >= total) break;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err : new Error(String(err));
  }

  // ── Classify and persist ───────────────────────────────────────────────────
  const classification = classifyWorkdayFailure({
    httpStatus:   lastStatus,
    body:         lastBody,
    error:        fetchError ?? undefined,
    failureCount: meta.consecutiveFailureCount,
    highPriority: meta.highPriority,
  });

  const effective = jobs.length > 0
    ? {
        ...classification,
        verificationStatus: "api_valid"  as const,
        fetchStrategy:      "API"        as const,
        syncEnabled:        true,
        nextRetryAt:        null,
        action:             "keep_api"   as const,
        message:            `${jobs.length} jobs fetched`,
      }
    : classification;

  prisma.jobSource
    .update({
      where: { id: source.id },
      data:  buildWorkdaySourceUpdate(source, effective, {
        httpStatus:   lastStatus,
        lastError:    fetchError?.message ?? null,
        lastJobCount: jobs.length,
      }),
    })
    .catch((e) => console.warn(`[workday] metadata update failed for ${source.company}:`, e));

  if (jobs.length > 0) return jobs;

  if (fetchError && effective.verificationStatus === "temporary_failure") {
    throw new Error(`Workday temporary failure for ${source.company}: ${fetchError.message}`);
  }

  if (effective.verificationStatus !== "api_valid") {
    console.log(
      `[workday] ${source.company} classified as ${effective.verificationStatus} ` +
      `(HTTP ${lastStatus ?? "n/a"}). Returning [] silently.`,
    );
  }
  return [];
}

// ── Scraper fetcher ─────────────────────────────────────────────────────────

async function fetchWorkdayScrapedJobs(source: JobSource): Promise<NormalizedJob[]> {
  const meta = parseWorkdayMeta(source);
  const result = await scrapeWorkdaySource({ company: source.company, url: source.url });
  const now = new Date();

  // ── Blocked (CAPTCHA / auth / Cloudflare) ─────────────────────────────────
  if (result.mode === "blocked") {
    prisma.jobSource
      .update({
        where: { id: source.id },
        data: {
          enabled:            false,
          verificationStatus: "browser_required",
          fetchStrategy:      "DISABLED",
          metadata: JSON.stringify({
            workday: {
              ...meta,
              verificationStatus: "browser_required",
              fetchStrategy:      "DISABLED",
              lastVerifiedAt:     now.toISOString(),
              lastFailedSyncAt:   now.toISOString(),
              lastError:          `scraper blocked: ${result.blockReason ?? "unknown"}`,
            },
          }),
          lastSyncAt:     now,
          lastSyncStatus: `browser_required: ${result.blockReason ?? "blocked"}`,
        },
      })
      .catch(() => {});
    console.log(`[workday-scraper] ${source.company} blocked (${result.blockReason}); disabled, no retry.`);
    return [];
  }

  // ── API endpoint discovered → switch source to API mode ────────────────────
  if (result.mode === "api_discovered" && result.discovery) {
    const apiUrl = result.discovery.apiUrl;
    // Avoid UNIQUE collision: only update url if no other source owns it
    const existing = await prisma.jobSource.findUnique({ where: { url: apiUrl } }).catch(() => null);
    const updateUrl = !existing || existing.id === source.id;

    prisma.jobSource
      .update({
        where: { id: source.id },
        data: {
          ...(updateUrl ? { url: apiUrl } : {}),
          enabled:            true,
          verificationStatus: "api_valid",
          fetchStrategy:      "API",
          nextRetryAt:        null,
          metadata: JSON.stringify({
            workday: {
              ...meta,
              verificationStatus:      "api_valid",
              fetchStrategy:           "API",
              lastStatusCode:          200,
              lastVerifiedAt:          now.toISOString(),
              lastSuccessfulSyncAt:    now.toISOString(),
              failureCount:            0,
              consecutiveFailureCount: 0,
              lastError:               null,
              lastJobCount:            result.jobs.length,
            },
          }),
          lastSyncAt:     now,
          lastSyncStatus: `OK: CXS discovered via browser (${result.discovery.total} total)`,
        },
      })
      .catch((e) => console.warn(`[workday-scraper] promote-to-API update failed for ${source.company}:`, e));

    console.log(`[workday-scraper] ${source.company} → CXS endpoint discovered; switched to API mode.`);
    return result.jobs;
  }

  // ── DOM scrape succeeded ───────────────────────────────────────────────────
  if (result.mode === "dom" && result.jobs.length > 0) {
    prisma.jobSource
      .update({
        where: { id: source.id },
        data: {
          enabled:            true,
          verificationStatus: "scraper_valid",
          fetchStrategy:      "SCRAPER",
          nextRetryAt:        null,
          metadata: JSON.stringify({
            workday: {
              ...meta,
              verificationStatus:      "scraper_valid",
              fetchStrategy:           "SCRAPER",
              lastVerifiedAt:          now.toISOString(),
              lastSuccessfulSyncAt:    now.toISOString(),
              failureCount:            0,
              consecutiveFailureCount: 0,
              lastError:               null,
              lastJobCount:            result.jobs.length,
            },
          }),
          lastSyncAt:     now,
          lastSyncStatus: `OK: scraped ${result.jobs.length} jobs (DOM)`,
        },
      })
      .catch((e) => console.warn(`[workday-scraper] scraper_valid update failed for ${source.company}:`, e));

    return result.jobs;
  }

  // ── Empty — page rendered but no jobs found ───────────────────────────────
  prisma.jobSource
    .update({
      where: { id: source.id },
      data: {
        metadata: JSON.stringify({
          workday: { ...meta, lastVerifiedAt: now.toISOString(), lastJobCount: 0 },
        }),
        lastSyncAt:     now,
        lastSyncStatus: "scraper: no jobs found on page",
      },
    })
    .catch(() => {});
  return [];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchJobsFromWorkday(source: JobSource): Promise<NormalizedJob[]> {
  // Decide path. Scraper only when explicitly enabled + eligible.
  if (isScraperEligible(source, WORKDAY_SCRAPER_ENABLED)) {
    // Safety: never scrape a source without a derivable public page
    if (parseCxsUrl(source.url)) {
      return fetchWorkdayScrapedJobs(source);
    }
  }
  return fetchWorkdayApiJobs(source);
}
