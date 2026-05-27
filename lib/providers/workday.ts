/**
 * lib/providers/workday.ts
 *
 * Fetches jobs from Workday's undocumented public JSON API.
 * Endpoint: POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * "Latest jobs only" strategy:
 *   - Fetches up to WORKDAY_MAX_PAGES pages (default 5, 20 jobs/page = 100 jobs max)
 *   - Stops early once it hits a job older than WORKDAY_MAX_AGE_DAYS (default 14)
 *   - Jobs with unknown age (null postedOn) are always included
 *
 * Env vars:
 *   WORKDAY_MAX_PAGES    — max pages to fetch per source  (default: 5)
 *   WORKDAY_PAGE_SIZE    — jobs per page                  (default: 20, max 20)
 *   WORKDAY_MAX_AGE_DAYS — oldest job to include in days  (default: 14)
 */

import type { JobSource } from "@prisma/client";
import type { NormalizedJob } from "../types";
import { normalizeLocation } from "../normalizers";

const FETCH_TIMEOUT_MS = Math.max(
  5_000,
  parseInt(process.env.SOURCE_FETCH_TIMEOUT_MS ?? "20000", 10) || 20_000,
);
const MAX_PAGES     = Math.max(1, parseInt(process.env.WORKDAY_MAX_PAGES    ?? "5",  10) || 5);
const PAGE_SIZE     = Math.min(20, Math.max(1, parseInt(process.env.WORKDAY_PAGE_SIZE   ?? "20", 10) || 20));
const MAX_AGE_DAYS  = Math.max(1, parseInt(process.env.WORKDAY_MAX_AGE_DAYS ?? "14", 10) || 14);

// ── Workday response types ────────────────────────────────────────────────────

type WorkdayPosting = {
  title?:               string;
  externalPath?:        string;
  locationsText?:       string;
  postedOn?:            string;  // "Posted Today" | "Posted 3 Days Ago" | "Posted 30+ Days Ago"
  bulletFields?:        string[];
  jobReqId?:            string;
  additionalLocations?: Array<{ locationsText?: string }>;
};

type WorkdayResponse = {
  total?:        number;
  jobPostings?:  WorkdayPosting[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert Workday's human-readable "Posted X Days Ago" string to an ISO date.
 * Returns undefined for unparseable values (they are still included in results).
 */
export function parseWorkdayPostedOn(postedOn: string | undefined): string | undefined {
  if (!postedOn) return undefined;
  const s = postedOn.toLowerCase().trim();

  if (s.includes("today") || s.includes("just posted")) {
    return new Date().toISOString();
  }

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

/**
 * Returns false if the job is definitively older than maxAgeDays.
 * Returns true for unknown/unparseable ages (include by default).
 */
function isRecentEnough(postedOn: string | undefined, maxAgeDays: number): boolean {
  if (!postedOn) return true;
  const s = postedOn.toLowerCase();

  // "30+ days ago" — Workday caps display at 30+, treat as stale
  if (s.includes("30+")) return false;

  const daysMatch = s.match(/(\d+)\s+day/);
  if (daysMatch) return parseInt(daysMatch[1], 10) <= maxAgeDays;

  const weeksMatch = s.match(/(\d+)\s+week/);
  if (weeksMatch) return parseInt(weeksMatch[1], 10) * 7 <= maxAgeDays;

  // Anything with "month" is old
  if (s.includes("month")) return false;

  return true; // "today", "just posted", unknown → include
}

/** POST one page to the Workday jobs API. */
async function fetchWorkdayPage(
  apiUrl: string,
  offset: number,
  limit: number,
): Promise<WorkdayResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept":        "application/json",
        "User-Agent":    "JobRadarMVP/0.1 (+https://local.jobradar)",
      },
      body:   JSON.stringify({ appliedFacets: {}, limit, offset, searchText: "" }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as WorkdayResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive the human-facing apply URL from an externalPath.
 *
 * API URL  : https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs
 * Apply URL: https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite{externalPath}
 */
function buildApplyUrl(apiUrl: string, externalPath: string): string {
  try {
    const u     = new URL(apiUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    // parts: ["wday", "cxs", tenant, site, "jobs"]
    const site  = parts[3] ?? "";
    return `${u.protocol}//${u.host}/en-US/${site}${externalPath}`;
  } catch {
    return apiUrl;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchJobsFromWorkday(
  source: JobSource,
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  let reachedOldJobs = false;

  for (let page = 0; page < MAX_PAGES && !reachedOldJobs; page++) {
    const offset = page * PAGE_SIZE;
    const data   = await fetchWorkdayPage(source.url, offset, PAGE_SIZE);
    const postings = data.jobPostings ?? [];

    if (postings.length === 0) break;

    for (const p of postings) {
      const title = p.title?.trim();
      if (!title) continue;

      // Once we hit a stale posting, stop paginating — Workday returns newest first
      if (!isRecentEnough(p.postedOn, MAX_AGE_DAYS)) {
        reachedOldJobs = true;
        break;
      }

      const externalPath = p.externalPath ?? "";
      const applyUrl     = externalPath
        ? buildApplyUrl(source.url, externalPath)
        : source.url;

      // Build full location string including additional locations
      const locationParts = [
        p.locationsText,
        ...(p.additionalLocations ?? []).map((l) => l.locationsText).filter(Boolean),
      ].filter(Boolean);
      const location = normalizeLocation(locationParts[0]);

      // Employment type is typically first bulletField: "Full time", "Part time", "Contract"
      const employmentType = p.bulletFields?.find(
        (f) => /full.time|part.time|contract|temporary|intern/i.test(f),
      );

      jobs.push({
        externalId:     p.jobReqId || undefined,
        company:        source.company,
        title,
        location,
        applyUrl,
        postedAt:       parseWorkdayPostedOn(p.postedOn),
        employmentType: employmentType || undefined,
      });
    }

    // Fewer results than requested → last page
    if (postings.length < PAGE_SIZE) break;
  }

  return jobs;
}
