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

// ── Global sync resolution (which sources to actually fetch from) ─────────────

/**
 * Resolve which sources the system-wide sync should fetch from.
 *
 * The system sync is intentionally global — it fetches jobs for all users.
 * A source is included if:
 *   - At least one user has it in their UserJobSource (with enabled=true), OR
 *   - At least one user has useGlobalDefaultSources=true (in which case ALL global sources are included)
 *
 * If neither condition is met for any user → NO_SOURCES_CONFIGURED.
 */
export async function resolveGlobalSyncSources(): Promise<GlobalSyncResolution> {
  const [userSourceCount, globalOptInCount, globalSourceCount] = await Promise.all([
    prisma.userJobSource.count({ where: { enabled: true } }),
    prisma.userJobPreference.count({ where: { useGlobalDefaultSources: true } }),
    prisma.jobSource.count({ where: { enabled: true } }),
  ]);

  // Case: at least one user opted into global defaults → sync ALL global sources
  if (globalOptInCount > 0) {
    const sources = await prisma.jobSource.findMany({
      where:   { enabled: true },
      orderBy: [{ provider: "asc" }, { company: "asc" }],
    });
    return {
      mode:               sources.length > 0 ? "global_defaults" : "none",
      sources,
      globalSourceCount,
      profileSourceCount: userSourceCount,
      reason:             sources.length > 0 ? null : NO_SOURCES_CONFIGURED,
      message:            sources.length > 0 ? null : "No global sources are enabled.",
    };
  }

  // Case: users have explicit source selections → sync the union
  if (userSourceCount > 0) {
    const userSourceLinks = await prisma.userJobSource.findMany({
      where:  { enabled: true },
      select: { sourceId: true },
      // dedup at query level would need groupBy; deduplicate in JS instead
    });
    const sourceIdSet = new Set(userSourceLinks.map((u) => u.sourceId));
    const sources = await prisma.jobSource.findMany({
      where:   { enabled: true, id: { in: [...sourceIdSet] } },
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
  const message = globalSourceCount > 0
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
