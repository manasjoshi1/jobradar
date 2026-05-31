/**
 * lib/providers/workday.ts
 *
 * Fetches jobs from Workday's undocumented public JSON API.
 * Endpoint: POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * "Latest jobs only" strategy:
 *   - Fetches up to WORKDAY_MAX_PAGES pages (default 5, 20 jobs/page = 100 jobs max)
 *   - Stops early once it hits a job older than WORKDAY_MAX_AGE_DAYS (default 14)
 *
 * Lifecycle behaviour:
 *   - On success: updates source to api_valid, resets failure counts.
 *   - On permanent failure (422/401/404/403): classifies, disables source, returns [].
 *   - On temporary failure (5xx/timeout): classifies, sets nextRetryAt, throws so
 *     sync-service records the failure and counts it.
 *
 * Env vars:
 *   WORKDAY_MAX_PAGES    — max pages to fetch per source  (default: 5)
 *   WORKDAY_PAGE_SIZE    — jobs per page                  (default: 20, max 20)
 *   WORKDAY_MAX_AGE_DAYS — oldest job to include in days  (default: 14)
 */

import type { JobSource } from "@prisma/client";
import type { NormalizedJob } from "../types";
import { normalizeLocation } from "../normalizers";
import { prisma } from "../prisma";
import {
  classifyWorkdayFailure,
  buildWorkdaySourceUpdate,
  parseWorkdayMeta,
} from "../workday/lifecycle";

const FETCH_TIMEOUT_MS = Math.max(
  5_000,
  parseInt(process.env.SOURCE_FETCH_TIMEOUT_MS ?? "20000", 10) || 20_000,
);
const MAX_PAGES    = Math.max(1, parseInt(process.env.WORKDAY_MAX_PAGES    ?? "5",  10) || 5);
const PAGE_SIZE    = Math.min(20, Math.max(1, parseInt(process.env.WORKDAY_PAGE_SIZE ?? "20", 10) || 20));
const MAX_AGE_DAYS = Math.max(1, parseInt(process.env.WORKDAY_MAX_AGE_DAYS ?? "14", 10) || 14);

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkdayPosting = {
  title?:               string;
  externalPath?:        string;
  locationsText?:       string;
  postedOn?:            string;
  bulletFields?:        string[];
  jobReqId?:            string;
  additionalLocations?: Array<{ locationsText?: string }>;
};

type WorkdayResponse = {
  total?:       number;
  jobPostings?: WorkdayPosting[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseWorkdayPostedOn(postedOn: string | undefined): string | undefined {
  if (!postedOn) return undefined;
  const s = postedOn.toLowerCase().trim();

  if (s.includes("today") || s.includes("just posted")) return new Date().toISOString();

  const daysMatch = s.match(/(\d+)\s+day/);
  if (daysMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(daysMatch[1], 10));
    return d.toISOString();
  }

  const weeksMatch = s.match(/(\d+)\s+week/);
  if (weeksMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(weeksMatch[1], 10) * 7);
    return d.toISOString();
  }

  const monthsMatch = s.match(/(\d+)\s+month/);
  if (monthsMatch) {
    const d = new Date();
    d.setMonth(d.getMonth() - parseInt(monthsMatch[1], 10));
    return d.toISOString();
  }

  return undefined;
}

function isRecentEnough(postedOn: string | undefined, maxAgeDays: number): boolean {
  if (!postedOn) return true;
  const s = postedOn.toLowerCase();
  if (s.includes("30+")) return false;

  const daysMatch = s.match(/(\d+)\s+day/);
  if (daysMatch) return parseInt(daysMatch[1], 10) <= maxAgeDays;

  const weeksMatch = s.match(/(\d+)\s+week/);
  if (weeksMatch) return parseInt(weeksMatch[1], 10) * 7 <= maxAgeDays;

  if (s.includes("month")) return false;
  return true;
}

function buildApplyUrl(apiUrl: string, externalPath: string): string {
  try {
    const u     = new URL(apiUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const site  = parts[3] ?? "";
    return `${u.protocol}//${u.host}/en-US/${site}${externalPath}`;
  } catch {
    return apiUrl;
  }
}

/**
 * POST one page. Returns { status, body } — never throws on HTTP errors.
 * Throws only on AbortError (timeout) or unrecoverable network failure.
 */
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
    } catch {
      // JSON parse error → invalid_schema
    }

    return { status: 200, body };
  } finally {
    clearTimeout(timer);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchJobsFromWorkday(source: JobSource): Promise<NormalizedJob[]> {
  const meta          = parseWorkdayMeta(source);
  const jobs: NormalizedJob[] = [];
  let   reachedOldJobs = false;
  let   lastStatus: number | null = null;
  let   lastBody: unknown         = null;
  let   fetchError: Error | null  = null;

  // ── Fetch pages ───────────────────────────────────────────────────────────
  try {
    for (let page = 0; page < MAX_PAGES && !reachedOldJobs; page++) {
      let pageResult: { status: number; body: WorkdayResponse };
      try {
        pageResult = await fetchWorkdayPage(source.url, page * PAGE_SIZE, PAGE_SIZE);
      } catch (err) {
        fetchError = err instanceof Error ? err : new Error(String(err));
        break;
      }

      lastStatus = pageResult.status;
      lastBody   = pageResult.body;

      if (lastStatus !== 200) break;

      const postings = pageResult.body.jobPostings ?? [];
      if (postings.length === 0) break;

      for (const p of postings) {
        const title = p.title?.trim();
        if (!title) continue;

        if (!isRecentEnough(p.postedOn, MAX_AGE_DAYS)) {
          reachedOldJobs = true;
          break;
        }

        const externalPath = p.externalPath ?? "";
        const applyUrl     = externalPath ? buildApplyUrl(source.url, externalPath) : source.url;

        const locationParts = [
          p.locationsText,
          ...(p.additionalLocations ?? []).map((l) => l.locationsText).filter(Boolean),
        ].filter(Boolean);

        const employmentType = p.bulletFields?.find(
          (f) => /full.time|part.time|contract|temporary|intern/i.test(f),
        );

        jobs.push({
          externalId:     p.jobReqId || undefined,
          company:        source.company,
          title,
          location:       normalizeLocation(locationParts[0]),
          applyUrl,
          postedAt:       parseWorkdayPostedOn(p.postedOn),
          employmentType: employmentType || undefined,
        });
      }

      if (postings.length < PAGE_SIZE) break;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err : new Error(String(err));
  }

  // ── Classify and persist lifecycle state ──────────────────────────────────
  const classification = classifyWorkdayFailure({
    httpStatus:   lastStatus,
    body:         lastBody,
    error:        fetchError ?? undefined,
    failureCount: meta.consecutiveFailureCount,
    highPriority: meta.highPriority,
  });

  // If we collected jobs (possibly after earlier pages succeeded), force api_valid
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

  // Persist asynchronously — don't block or crash the sync
  prisma.jobSource
    .update({
      where: { id: source.id },
      data:  buildWorkdaySourceUpdate(source, effective, {
        httpStatus:   lastStatus,
        lastError:    fetchError?.message ?? null,
        lastJobCount: jobs.length,
      }),
    })
    .catch((e) =>
      console.warn(`[workday] metadata update failed for ${source.company}:`, e),
    );

  // ── Return or rethrow ─────────────────────────────────────────────────────
  if (jobs.length > 0) return jobs;

  if (fetchError && effective.verificationStatus === "temporary_failure") {
    // Re-throw so sync-service records a failure and applies backoff via nextRetryAt
    throw new Error(`Workday temporary failure for ${source.company}: ${fetchError.message}`);
  }

  // Permanent failure — log and return [] (sync continues with other sources)
  if (effective.verificationStatus !== "api_valid") {
    console.log(
      `[workday] ${source.company} classified as ${effective.verificationStatus} ` +
      `(HTTP ${lastStatus ?? "n/a"}). Source disabled; returning [] silently.`,
    );
  }

  return [];
}
