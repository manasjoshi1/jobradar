/**
 * lib/workday/parse.ts
 *
 * Pure parsing/normalization helpers shared by the Workday API fetcher
 * and the Playwright scraper. No side effects, no I/O.
 */

import type { NormalizedJob } from "../types";
import { normalizeLocation } from "../normalizers";

// ── postedOn parsing ────────────────────────────────────────────────────────

/**
 * Convert Workday's human-readable "Posted X Days Ago" string to an ISO date.
 * Returns undefined for unparseable / missing values.
 *
 * Handles:
 *   Posted Today / Today / Just Posted    → today
 *   Posted Yesterday / Yesterday          → today − 1 day
 *   N Day(s) Ago                          → today − N days
 *   N Week(s) Ago                         → today − N·7 days
 *   N Month(s) Ago                        → today − N·30 days
 *   30+ Days Ago                          → today − 30 days
 */
export function parseWorkdayPostedOn(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const s = value.toLowerCase().trim();

  if (s.includes("just posted") || /\btoday\b/.test(s)) {
    return new Date().toISOString();
  }
  if (/\byesterday\b/.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }

  // "30+ days ago" — Workday caps display at 30+
  if (s.includes("30+")) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }

  const days = s.match(/(\d+)\s*\+?\s*day/);
  if (days) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(days[1], 10));
    return d.toISOString();
  }

  const weeks = s.match(/(\d+)\s*\+?\s*week/);
  if (weeks) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(weeks[1], 10) * 7);
    return d.toISOString();
  }

  const months = s.match(/(\d+)\s*\+?\s*month/);
  if (months) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(months[1], 10) * 30);
    return d.toISOString();
  }

  return undefined;
}

/** True if `iso` is within `maxAgeDays` of now. Missing date counts as recent. */
export function isWithinDays(iso: string | undefined, maxAgeDays: number): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= maxAgeDays * 24 * 60 * 60 * 1_000;
}

// ── URL helpers ─────────────────────────────────────────────────────────────

export type CxsParts = {
  host:   string;  // nvidia.wd5.myworkdayjobs.com
  tenant: string;  // nvidia
  site:   string;  // NVIDIAExternalCareerSite
};

/**
 * Extract host/tenant/site from a CXS API URL.
 *   https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs
 */
export function parseCxsUrl(apiUrl: string): CxsParts | null {
  try {
    const u = new URL(apiUrl);
    const parts = u.pathname.split("/").filter(Boolean); // [wday, cxs, tenant, site, jobs]
    const cxsIdx = parts.indexOf("cxs");
    if (cxsIdx === -1 || parts.length < cxsIdx + 3) return null;
    return {
      host:   u.host,
      tenant: parts[cxsIdx + 1],
      site:   parts[cxsIdx + 2],
    };
  } catch {
    return null;
  }
}

/** Build the CXS jobs endpoint from parts. */
export function buildCxsUrl(parts: CxsParts): string {
  return `https://${parts.host}/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
}

/**
 * Build the public apply URL from a CXS API URL + externalPath.
 *   API:   https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs
 *   path:  /job/.../R12345
 *   apply: https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/.../R12345
 */
export function buildApplyUrl(apiUrl: string, externalPath: string): string {
  const parts = parseCxsUrl(apiUrl);
  if (!parts) return apiUrl;
  return `https://${parts.host}/en-US/${parts.site}${externalPath}`;
}

/** Build the public careers page URL from a CXS API URL. */
export function buildPublicPageUrl(apiUrl: string): string | null {
  const parts = parseCxsUrl(apiUrl);
  if (!parts) return null;
  return `https://${parts.host}/en-US/${parts.site}`;
}

// ── Job normalization ─────────────────────────────────────────────────────────

type RawApiPosting = {
  title?:        string;
  externalPath?: string;
  locationsText?: string;
  postedOn?:     string;
  bulletFields?: string[];
  timeType?:     string;
  remoteType?:   string;
  jobFamily?:    string;
  jobType?:      string;
  jobReqId?:     string;
  additionalLocations?: Array<{ locationsText?: string }>;
};

/** Normalize one CXS API posting into the JobRadar NormalizedJob model. */
export function normalizeWorkdayApiJob(
  posting: RawApiPosting,
  source:  { company: string; url: string },
): NormalizedJob | null {
  const title = posting.title?.trim();
  if (!title) return null;

  const externalPath = posting.externalPath ?? "";
  const applyUrl     = externalPath ? buildApplyUrl(source.url, externalPath) : source.url;

  const locationParts = [
    posting.locationsText,
    ...(posting.additionalLocations ?? []).map((l) => l.locationsText).filter(Boolean),
  ].filter(Boolean);

  // externalId: prefer requisition-looking bulletField, else jobReqId, else externalPath
  const reqLike = posting.bulletFields?.find((f) => /^(jr|r-|req-)?\d|[A-Z]{1,4}-?\d+/i.test(f));
  const externalId = reqLike || posting.jobReqId || externalPath || undefined;

  return {
    externalId,
    company:        source.company,
    title,
    location:       normalizeLocation(locationParts[0]),
    department:     posting.jobFamily || undefined,
    employmentType: posting.timeType || posting.jobType || undefined,
    applyUrl,
    postedAt:       parseWorkdayPostedOn(posting.postedOn),
  };
}

type RawDomJob = {
  title:    string;
  location?: string;
  postedOn?: string;
  applyUrl: string;
  reqId?:   string;
};

/** Normalize one DOM-scraped job into the JobRadar NormalizedJob model. */
export function normalizeWorkdayDomJob(
  job:    RawDomJob,
  source: { company: string },
): NormalizedJob | null {
  const title = job.title?.trim();
  if (!title || !job.applyUrl) return null;

  // externalId: extract requisition pattern from applyUrl or reqId
  const reqMatch = job.applyUrl.match(/(JR-?\d+|R-?\d{4,}|REQ-?\d+)/i);
  const externalId = job.reqId || reqMatch?.[1] || undefined;

  return {
    externalId,
    company:   source.company,
    title,
    location:  normalizeLocation(job.location),
    applyUrl:  job.applyUrl,
    postedAt:  parseWorkdayPostedOn(job.postedOn),
  };
}
