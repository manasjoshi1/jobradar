/**
 * Centralized source resolution — the single authority on which sources
 * a user or the global sync should use.
 *
 * Rules (applied in order):
 *   1. If user has UserJobSource rows → "profile" mode (use those sources only)
 *   2. If user has no UserJobSource rows AND useGlobalDefaultSources=true → "global_defaults" mode
 *   3. Otherwise → "none" mode (NO_SOURCES_CONFIGURED)
 *
 * "Global defaults" is an explicit opt-in stored in UserJobPreference.
 * It is NEVER inferred from source count = 0, missing prefs, sync failures, etc.
 *
 * All sync and recommendation services MUST use these functions.
 * Do not duplicate fallback logic elsewhere.
 */

import { prisma } from "@/lib/prisma";
import type { JobSource } from "@prisma/client";
import { SYNC_EXCLUDED_STATUSES } from "@/lib/workday/lifecycle";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceMode = "profile" | "global_defaults" | "none";

export const NO_SOURCES_CONFIGURED = "NO_SOURCES_CONFIGURED" as const;

/** Per-user source resolution result (for recommendations). */
export type UserSourceResolution = {
  mode:                    SourceMode;
  /** null = all sources ok (global_defaults); Set = specific allowed sourceIds; empty Set = no sources */
  allowedSourceIds:        Set<string> | null;
  useGlobalDefaultSources: boolean;
  profileSourceCount:      number;
  globalSourceCount:       number;
  canSync:                 boolean;
  reason:                  typeof NO_SOURCES_CONFIGURED | null;
  message:                 string | null;
};

/** System-wide source resolution result (for sync). */
export type GlobalSyncResolution = {
  mode:               SourceMode;
  sources:            JobSource[];
  globalSourceCount:  number;
  profileSourceCount: number; // total user-selected source links (across all users)
  reason:             typeof NO_SOURCES_CONFIGURED | null;
  message:            string | null;
};

// ── Per-user resolution (recommendations, status endpoint) ────────────────────

/**
 * Resolve which jobs a user is eligible to receive recommendations for.
 *
 * Returns `allowedSourceIds`:
 *   - `null`         → user is in global_defaults mode; all globally synced jobs are eligible
 *   - `Set<string>`  → only jobs from these sourceIds are eligible
 *   - empty `Set`    → no jobs eligible (NO_SOURCES_CONFIGURED)
 */
export async function resolveUserSources(userId: string): Promise<UserSourceResolution> {
  const [userSourceRows, prefs, globalSourceCount] = await Promise.all([
    prisma.userJobSource.findMany({
      where:  { userId, enabled: true },
      select: { sourceId: true },
    }),
    prisma.userJobPreference.findUnique({
      where:  { userId },
      select: { useGlobalDefaultSources: true },
    }),
    prisma.jobSource.count({ where: { enabled: true } }),
  ]);

  const profileSourceCount      = userSourceRows.length;
  const useGlobalDefaultSources = prefs?.useGlobalDefaultSources ?? false;

  if (profileSourceCount > 0) {
    return {
      mode:                    "profile",
      allowedSourceIds:        new Set(userSourceRows.map((r) => r.sourceId)),
      useGlobalDefaultSources,
      profileSourceCount,
      globalSourceCount,
      canSync:                 true,
      reason:                  null,
      message:                 null,
    };
  }

  if (useGlobalDefaultSources && globalSourceCount > 0) {
    return {
      mode:                    "global_defaults",
      allowedSourceIds:        null, // all globally synced jobs are eligible
      useGlobalDefaultSources: true,
      profileSourceCount:      0,
      globalSourceCount,
      canSync:                 true,
      reason:                  null,
      message:                 null,
    };
  }

  // No sources configured and not opted into global defaults
  const message = globalSourceCount > 0
    ? "No sources configured. Enable global defaults to use the shared source list, or upload your own."
    : "No sources configured and no global sources are available.";

  return {
    mode:                    "none",
    allowedSourceIds:        new Set(), // empty — no jobs eligible
    useGlobalDefaultSources,
    profileSourceCount:      0,
    globalSourceCount,
    canSync:                 false,
    reason:                  NO_SOURCES_CONFIGURED,
    message,
  };
}

// ── Sync-eligible source filter ───────────────────────────────────────────────

/**
 * Shared WHERE clause for fetching sources that are eligible for sync.
 *
 * A source is eligible when:
 *   - enabled = true
 *   - nextRetryAt is null OR nextRetryAt <= now  (not in backoff)
 *   - NOT (provider=WORKDAY AND verificationStatus in excluded list)
 *
 * Non-Workday sources are unaffected: verificationStatus is null for them,
 * so the NOT-Workday branch always passes.
 */
function syncEligibleWhere(now: Date = new Date()) {
  return {
    enabled: true,
    AND: [
      // Backoff gate: skip sources whose retry window hasn't expired
      {
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
      },
      // Workday lifecycle gate: exclude permanently-failed Workday sources
      {
        OR: [
          { provider: { not: "WORKDAY" } },
          { verificationStatus: null },
          { verificationStatus: { notIn: SYNC_EXCLUDED_STATUSES as string[] } },
        ],
      },
    ],
  };
}

// ── Global sync resolution (which sources to actually fetch from) ─────────────

/**
 * Resolve which sources the system-wide sync should fetch from.
 *
 * The system sync is intentionally global — it fetches jobs for all users.
 * A source is included if:
 *   - At least one user has it in their UserJobSource (with enabled=true), OR
 *   - At least one user has useGlobalDefaultSources=true (in which case ALL global sources are included)
 *
 * Workday sources with a permanent failure classification are excluded from
 * the sync regardless of their enabled flag.
 *
 * If neither condition is met for any user → NO_SOURCES_CONFIGURED.
 */
export async function resolveGlobalSyncSources(): Promise<GlobalSyncResolution> {
  const now = new Date();
  const eligibleWhere = syncEligibleWhere(now);

  const [userSourceCount, globalOptInCount, globalSourceCount] = await Promise.all([
    prisma.userJobSource.count({ where: { enabled: true } }),
    prisma.userJobPreference.count({ where: { useGlobalDefaultSources: true } }),
    prisma.jobSource.count({ where: eligibleWhere }),
  ]);

  // Case: at least one user opted into global defaults → sync ALL eligible global sources
  if (globalOptInCount > 0) {
    const sources = await prisma.jobSource.findMany({
      where:   eligibleWhere,
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    });
    return {
      mode:               sources.length > 0 ? "global_defaults" : "none",
      sources,
      globalSourceCount,
      profileSourceCount: userSourceCount,
      reason:             sources.length > 0 ? null : NO_SOURCES_CONFIGURED,
      message:            sources.length > 0 ? null : "No global sources are eligible for sync.",
    };
  }

  // Case: users have explicit source selections → sync the eligible union
  if (userSourceCount > 0) {
    const userSourceLinks = await prisma.userJobSource.findMany({
      where:  { enabled: true },
      select: { sourceId: true },
    });
    const sourceIdSet = new Set(userSourceLinks.map((u) => u.sourceId));
    const sources = await prisma.jobSource.findMany({
      where:   { ...eligibleWhere, id: { in: [...sourceIdSet] } },
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    });
    return {
      mode:               "profile",
      sources,
      globalSourceCount,
      profileSourceCount: userSourceCount,
      reason:             null,
      message:            null,
    };
  }

  // Case: no sources configured anywhere
  const totalEnabled = await prisma.jobSource.count({ where: { enabled: true } });
  const message = totalEnabled > 0
    ? "No sources configured. Enable global defaults to use the shared source list, or upload sources."
    : "No sources configured and no global sources are available.";

  return {
    mode:               "none",
    sources:            [],
    globalSourceCount,
    profileSourceCount: 0,
    reason:             NO_SOURCES_CONFIGURED,
    message,
  };
}
