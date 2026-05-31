/**
 * lib/workday/lifecycle.ts
 *
 * Workday source lifecycle — failure classification, backoff rules,
 * metadata helpers, and Prisma update builders.
 *
 * This module is intentionally side-effect-free: it only returns plain
 * data objects ready to be written to the DB by the caller.
 */

import type { JobSource } from "@prisma/client";

// ── Public types ──────────────────────────────────────────────────────────────

export type WorkdayVerificationStatus =
  | "unverified"
  | "api_valid"
  | "wrong_site_slug"
  | "auth_blocked"
  | "browser_required"
  | "host_dead"
  | "invalid_schema"
  | "temporary_failure"
  | "scraper_candidate"
  | "scraper_valid"
  | "disabled";

export type WorkdayFetchStrategy = "API" | "SCRAPER" | "AUTO" | "DISABLED";

/** What action should the verify script report in its CSV output? */
export type WorkdayAction =
  | "keep_api"
  | "disable_wrong_slug"
  | "disable_auth_blocked"
  | "disable_browser_required"
  | "disable_host_dead"
  | "disable_invalid_schema"
  | "temporary_backoff"
  | "queue_slug_discovery"
  | "queue_scraper_candidate"
  | "no_change";

/** Set of verification statuses excluded from the normal hourly sync. */
export const SYNC_EXCLUDED_STATUSES: WorkdayVerificationStatus[] = [
  "wrong_site_slug",
  "auth_blocked",
  "browser_required",
  "host_dead",
  "invalid_schema",
  "disabled",
];

/**
 * Decide whether a Workday source is eligible for browser scraping right now.
 *
 * Scraping requires ALL of:
 *   - WORKDAY_SCRAPER_ENABLED=true (checked by caller via `scraperEnabled`)
 *   - fetchStrategy in SCRAPER | AUTO
 *   - verificationStatus in scraper_candidate | scraper_valid
 *   - source.enabled = true
 *   - not in backoff (caller checks nextRetryAt)
 *
 * Never scrape auth_blocked, host_dead, invalid_schema, or disabled sources.
 */
export function isScraperEligible(
  source: Pick<JobSource, "enabled" | "fetchStrategy" | "verificationStatus" | "metadata">,
  scraperEnabled: boolean,
): boolean {
  if (!scraperEnabled) return false;
  if (!source.enabled) return false;

  const meta = parseWorkdayMeta(source);
  if (meta.manuallyDisabled) return false;

  const strategy = (source.fetchStrategy ?? meta.fetchStrategy) as WorkdayFetchStrategy | null;
  if (strategy !== "SCRAPER" && strategy !== "AUTO") return false;

  const status = (source.verificationStatus ?? meta.verificationStatus) as WorkdayVerificationStatus | null;
  if (status !== "scraper_candidate" && status !== "scraper_valid") return false;

  return true;
}

/** Statuses that must NEVER be scraped, regardless of strategy. */
export const SCRAPER_FORBIDDEN_STATUSES: WorkdayVerificationStatus[] = [
  "auth_blocked",
  "host_dead",
  "invalid_schema",
  "disabled",
];

/** Extended Workday metadata stored in JobSource.metadata JSON. */
export type WorkdaySourceMeta = {
  verificationStatus:   WorkdayVerificationStatus;
  fetchStrategy:        WorkdayFetchStrategy;
  lastStatusCode:       number | null;
  lastVerifiedAt:       string | null;   // ISO
  lastSuccessfulSyncAt: string | null;   // ISO
  lastFailedSyncAt:     string | null;   // ISO
  failureCount:         number;
  consecutiveFailureCount: number;
  lastError:            string | null;
  lastJobCount:         number | null;
  manuallyDisabled:     boolean;
  disabledReason:       string | null;
  disabledAt:           string | null;   // ISO
  highPriority:         boolean;
};

export type ClassificationResult = {
  verificationStatus:  WorkdayVerificationStatus;
  fetchStrategy:       WorkdayFetchStrategy;
  syncEnabled:         boolean;
  nextRetryAt:         Date | null;
  action:              WorkdayAction;
  message:             string;
};

// ── Metadata helpers ──────────────────────────────────────────────────────────

const DEFAULT_META: WorkdaySourceMeta = {
  verificationStatus:      "unverified",
  fetchStrategy:           "API",
  lastStatusCode:          null,
  lastVerifiedAt:          null,
  lastSuccessfulSyncAt:    null,
  lastFailedSyncAt:        null,
  failureCount:            0,
  consecutiveFailureCount: 0,
  lastError:               null,
  lastJobCount:            null,
  manuallyDisabled:        false,
  disabledReason:          null,
  disabledAt:              null,
  highPriority:            false,
};

/** Parse the metadata JSON from a JobSource row. Always returns a valid object. */
export function parseWorkdayMeta(source: Pick<JobSource, "metadata">): WorkdaySourceMeta {
  if (!source.metadata) return { ...DEFAULT_META };
  try {
    const parsed = JSON.parse(source.metadata);
    const wday = parsed?.workday ?? parsed ?? {};
    return { ...DEFAULT_META, ...wday };
  } catch {
    return { ...DEFAULT_META };
  }
}

/** Serialise back to the metadata JSON string. */
export function serializeWorkdayMeta(
  source: Pick<JobSource, "metadata">,
  updates: Partial<WorkdaySourceMeta>,
): string {
  const current = parseWorkdayMeta(source);
  const merged  = { ...current, ...updates };
  return JSON.stringify({ workday: merged });
}

// ── Backoff calculator ────────────────────────────────────────────────────────

/**
 * Exponential backoff for temporary failures.
 * failureCount 1 → +1 h, 2 → +6 h, 3 → +24 h, ≥4 → +72 h
 */
export function computeNextRetryAt(failureCount: number): Date {
  const HOURS = [1, 6, 24, 72];
  const h     = HOURS[Math.min(failureCount - 1, HOURS.length - 1)];
  return new Date(Date.now() + h * 60 * 60 * 1_000);
}

// ── Failure classifier ────────────────────────────────────────────────────────

/**
 * Given the raw HTTP outcome of a Workday CXS fetch attempt, decide the
 * verification status, whether the source should be re-enabled, the
 * next retry time, and what action to surface in the CSV report.
 *
 * Rules:
 *   200 + valid JSON (numeric total + jobPostings array)  → api_valid
 *   200 + bad/HTML body                                   → invalid_schema
 *   401                                                   → auth_blocked
 *   403                                                   → browser_required
 *   404                                                   → host_dead
 *   422                                                   → wrong_site_slug
 *   429 / 5xx                                             → temporary_failure
 *   timeout / network error                               → temporary_failure
 *   DNS failure                                           → host_dead
 */
export function classifyWorkdayFailure(
  opts: {
    httpStatus:    number | null;
    /** Parsed JSON body (if status 200 and JSON) */
    body?:         unknown;
    /** Error from fetch() / timeout */
    error?:        Error | null;
    /** Current consecutive failure count before this attempt */
    failureCount?: number;
    /** Is this a high-priority source? */
    highPriority?: boolean;
  },
): ClassificationResult {
  const { httpStatus, body, error, failureCount = 0, highPriority = false } = opts;
  const nextCount = failureCount + 1;

  // ── DNS / network hard errors ─────────────────────────────────────────────
  if (error && !httpStatus) {
    const msg = error.message.toLowerCase();
    const isDns = msg.includes("getaddrinfo") || msg.includes("enotfound") ||
                  msg.includes("dns") || msg.includes("failed to fetch");
    if (isDns) {
      return {
        verificationStatus: "host_dead",
        fetchStrategy:      "DISABLED",
        syncEnabled:        false,
        nextRetryAt:        null,
        action:             "disable_host_dead",
        message:            `DNS failure: ${error.message}`,
      };
    }
    // timeout / connection reset → temporary
    return {
      verificationStatus: "temporary_failure",
      fetchStrategy:      "API",
      syncEnabled:        true,
      nextRetryAt:        computeNextRetryAt(nextCount),
      action:             "temporary_backoff",
      message:            `Network error: ${error.message}`,
    };
  }

  switch (httpStatus) {
    case 200: {
      // Validate body: must have numeric total and jobPostings array
      const b = body as Record<string, unknown> | null;
      const hasTotal    = b != null && typeof b.total === "number";
      const hasPostings = b != null && Array.isArray(b.jobPostings);
      if (hasTotal && hasPostings) {
        return {
          verificationStatus: "api_valid",
          fetchStrategy:      "API",
          syncEnabled:        true,
          nextRetryAt:        null,
          action:             "keep_api",
          message:            `Valid API response — ${(b.jobPostings as unknown[]).length} job(s) in page`,
        };
      }
      return {
        verificationStatus: "invalid_schema",
        fetchStrategy:      "DISABLED",
        syncEnabled:        false,
        nextRetryAt:        null,
        action:             "disable_invalid_schema",
        message:            "HTTP 200 but response missing numeric total or jobPostings array",
      };
    }

    case 401:
      return {
        verificationStatus: "auth_blocked",
        fetchStrategy:      "DISABLED",
        syncEnabled:        false,
        nextRetryAt:        null,
        action:             "disable_auth_blocked",
        message:            "HTTP 401 — credentials required; API not publicly accessible",
      };

    case 403:
      return {
        verificationStatus: "browser_required",
        fetchStrategy:      highPriority ? "DISABLED" : "DISABLED", // no auto-promotion
        syncEnabled:        false,
        nextRetryAt:        null,
        action:             highPriority ? "queue_scraper_candidate" : "disable_browser_required",
        message:            "HTTP 403 — Cloudflare/challenge; browser required",
      };

    case 404:
      return {
        verificationStatus: "host_dead",
        fetchStrategy:      "DISABLED",
        syncEnabled:        false,
        nextRetryAt:        null,
        action:             "disable_host_dead",
        message:            "HTTP 404 — host or tenant path does not exist",
      };

    case 422:
      return {
        verificationStatus: "wrong_site_slug",
        fetchStrategy:      "DISABLED",
        syncEnabled:        false,
        nextRetryAt:        null,
        action:             "queue_slug_discovery",
        message:            "HTTP 422 — tenant host valid but site slug is wrong",
      };

    case 429:
      return {
        verificationStatus: "temporary_failure",
        fetchStrategy:      "API",
        syncEnabled:        true,
        nextRetryAt:        computeNextRetryAt(nextCount),
        action:             "temporary_backoff",
        message:            "HTTP 429 — rate limited",
      };

    default:
      if (httpStatus != null && httpStatus >= 500) {
        return {
          verificationStatus: "temporary_failure",
          fetchStrategy:      "API",
          syncEnabled:        true,
          nextRetryAt:        computeNextRetryAt(nextCount),
          action:             "temporary_backoff",
          message:            `HTTP ${httpStatus} — server error`,
        };
      }
      // Unknown / null status
      return {
        verificationStatus: "temporary_failure",
        fetchStrategy:      "API",
        syncEnabled:        true,
        nextRetryAt:        computeNextRetryAt(nextCount),
        action:             "temporary_backoff",
        message:            `Unknown status ${httpStatus ?? "null"}`,
      };
  }
}

// ── Prisma update builder ─────────────────────────────────────────────────────

/**
 * Build the Prisma `data` object to update a JobSource after a Workday
 * fetch attempt. Merges new state into existing metadata.
 */
export function buildWorkdaySourceUpdate(
  source: Pick<JobSource, "metadata" | "enabled">,
  classification: ClassificationResult,
  opts: {
    httpStatus?:  number | null;
    lastError?:   string | null;
    lastJobCount?: number | null;
    isSuccess?:   boolean;
  } = {},
): {
  enabled:           boolean;
  verificationStatus: string;
  fetchStrategy:     string;
  nextRetryAt:       Date | null;
  metadata:          string;
  lastSyncStatus:    string;
  lastSyncAt:        Date;
} {
  const now     = new Date();
  const meta    = parseWorkdayMeta(source);
  const isOk    = classification.verificationStatus === "api_valid";
  const isTemp  = classification.verificationStatus === "temporary_failure";

  const updatedMeta: Partial<WorkdaySourceMeta> = {
    verificationStatus:      classification.verificationStatus,
    fetchStrategy:           classification.fetchStrategy,
    lastStatusCode:          opts.httpStatus ?? null,
    lastVerifiedAt:          now.toISOString(),
    lastError:               opts.lastError ?? null,
    ...(opts.lastJobCount != null ? { lastJobCount: opts.lastJobCount } : {}),
    ...(isOk
      ? { failureCount: 0, consecutiveFailureCount: 0, lastSuccessfulSyncAt: now.toISOString() }
      : {
          failureCount:            (meta.failureCount ?? 0) + 1,
          consecutiveFailureCount: (meta.consecutiveFailureCount ?? 0) + 1,
          lastFailedSyncAt:        now.toISOString(),
        }),
    ...(isTemp ? {} : {}), // backoff computed inside classifyWorkdayFailure already
  };

  // Never re-enable a manually disabled source
  const shouldEnable = classification.syncEnabled && !meta.manuallyDisabled;

  return {
    enabled:            shouldEnable,
    verificationStatus: classification.verificationStatus,
    fetchStrategy:      classification.fetchStrategy,
    nextRetryAt:        classification.nextRetryAt,
    metadata:           serializeWorkdayMeta(source, updatedMeta),
    lastSyncStatus:     isOk
                          ? `OK: ${opts.lastJobCount ?? 0} jobs`
                          : `ERROR(${classification.verificationStatus}): ${classification.message.slice(0, 200)}`,
    lastSyncAt:         now,
  };
}
