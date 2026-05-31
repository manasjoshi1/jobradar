/**
 * __tests__/workday-lifecycle.test.ts
 *
 * Unit tests for the Workday source lifecycle module.
 * Covers all acceptance criteria defined in the product spec.
 */

import { describe, it, expect } from "vitest";
import {
  classifyWorkdayFailure,
  computeNextRetryAt,
  parseWorkdayMeta,
  serializeWorkdayMeta,
  buildWorkdaySourceUpdate,
  SYNC_EXCLUDED_STATUSES,
  type WorkdayVerificationStatus,
} from "../lib/workday/lifecycle";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal source shape accepted by buildWorkdaySourceUpdate / parseWorkdayMeta. */
type SourceLike = { metadata: string | null; enabled: boolean };

const VALID_BODY = { total: 42, jobPostings: [{ title: "Engineer" }] };
const EMPTY_SOURCE: SourceLike = { metadata: null, enabled: true };

// ── 1. api_valid ──────────────────────────────────────────────────────────────

describe("classifyWorkdayFailure — api_valid", () => {
  it("returns api_valid for HTTP 200 with valid body", () => {
    const r = classifyWorkdayFailure({ httpStatus: 200, body: VALID_BODY });
    expect(r.verificationStatus).toBe("api_valid");
    expect(r.fetchStrategy).toBe("API");
    expect(r.syncEnabled).toBe(true);
    expect(r.nextRetryAt).toBeNull();
    expect(r.action).toBe("keep_api");
  });

  it("api_valid source is NOT in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).not.toContain("api_valid");
  });
});

// ── 2. wrong_site_slug ────────────────────────────────────────────────────────

describe("classifyWorkdayFailure — wrong_site_slug (HTTP 422)", () => {
  it("classifies 422 as wrong_site_slug", () => {
    const r = classifyWorkdayFailure({ httpStatus: 422 });
    expect(r.verificationStatus).toBe("wrong_site_slug");
    expect(r.syncEnabled).toBe(false);
    expect(r.fetchStrategy).toBe("DISABLED");
    expect(r.nextRetryAt).toBeNull();
    expect(r.action).toBe("queue_slug_discovery");
  });

  it("wrong_site_slug is in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).toContain("wrong_site_slug");
  });
});

// ── 3. auth_blocked ───────────────────────────────────────────────────────────

describe("classifyWorkdayFailure — auth_blocked (HTTP 401)", () => {
  it("classifies 401 as auth_blocked", () => {
    const r = classifyWorkdayFailure({ httpStatus: 401 });
    expect(r.verificationStatus).toBe("auth_blocked");
    expect(r.syncEnabled).toBe(false);
    expect(r.nextRetryAt).toBeNull();
    expect(r.action).toBe("disable_auth_blocked");
  });

  it("auth_blocked is in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).toContain("auth_blocked");
  });
});

// ── 4. browser_required ───────────────────────────────────────────────────────

describe("classifyWorkdayFailure — browser_required (HTTP 403)", () => {
  it("classifies 403 as browser_required for normal sources", () => {
    const r = classifyWorkdayFailure({ httpStatus: 403, highPriority: false });
    expect(r.verificationStatus).toBe("browser_required");
    expect(r.syncEnabled).toBe(false);
    expect(r.action).toBe("disable_browser_required");
  });

  it("high-priority 403 gets queue_scraper_candidate action", () => {
    const r = classifyWorkdayFailure({ httpStatus: 403, highPriority: true });
    expect(r.verificationStatus).toBe("browser_required");
    expect(r.action).toBe("queue_scraper_candidate");
    expect(r.syncEnabled).toBe(false); // still disabled until scraper validates
  });

  it("browser_required is in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).toContain("browser_required");
  });
});

// ── 5. host_dead ─────────────────────────────────────────────────────────────

describe("classifyWorkdayFailure — host_dead (HTTP 404 / DNS)", () => {
  it("classifies 404 as host_dead", () => {
    const r = classifyWorkdayFailure({ httpStatus: 404 });
    expect(r.verificationStatus).toBe("host_dead");
    expect(r.syncEnabled).toBe(false);
    expect(r.nextRetryAt).toBeNull();
    expect(r.action).toBe("disable_host_dead");
  });

  it("DNS failure classifies as host_dead", () => {
    const err = new Error("getaddrinfo ENOTFOUND nvidia.wd99.myworkdayjobs.com");
    const r = classifyWorkdayFailure({ httpStatus: null, error: err });
    expect(r.verificationStatus).toBe("host_dead");
    expect(r.action).toBe("disable_host_dead");
  });

  it("host_dead is in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).toContain("host_dead");
  });
});

// ── 6. invalid_schema ────────────────────────────────────────────────────────

describe("classifyWorkdayFailure — invalid_schema (HTTP 200 bad body)", () => {
  it("classifies 200 with missing total as invalid_schema", () => {
    const r = classifyWorkdayFailure({ httpStatus: 200, body: { foo: "bar" } });
    expect(r.verificationStatus).toBe("invalid_schema");
    expect(r.syncEnabled).toBe(false);
    expect(r.action).toBe("disable_invalid_schema");
  });

  it("classifies 200 with null body as invalid_schema", () => {
    const r = classifyWorkdayFailure({ httpStatus: 200, body: null });
    expect(r.verificationStatus).toBe("invalid_schema");
  });

  it("invalid_schema is in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).toContain("invalid_schema");
  });
});

// ── 7. temporary_failure + backoff ───────────────────────────────────────────

describe("classifyWorkdayFailure — temporary_failure", () => {
  it("classifies 429 as temporary_failure with retry", () => {
    const r = classifyWorkdayFailure({ httpStatus: 429, failureCount: 0 });
    expect(r.verificationStatus).toBe("temporary_failure");
    expect(r.syncEnabled).toBe(true);
    expect(r.nextRetryAt).not.toBeNull();
    expect(r.action).toBe("temporary_backoff");
  });

  it("classifies 500 as temporary_failure", () => {
    const r = classifyWorkdayFailure({ httpStatus: 500, failureCount: 0 });
    expect(r.verificationStatus).toBe("temporary_failure");
  });

  it("classifies timeout (AbortError) as temporary_failure", () => {
    const err = new Error("The operation was aborted");
    const r = classifyWorkdayFailure({ httpStatus: null, error: err, failureCount: 0 });
    expect(r.verificationStatus).toBe("temporary_failure");
    expect(r.syncEnabled).toBe(true);
  });

  it("temporary_failure is NOT in SYNC_EXCLUDED_STATUSES", () => {
    expect(SYNC_EXCLUDED_STATUSES).not.toContain("temporary_failure");
  });
});

// ── 8. Backoff progression ────────────────────────────────────────────────────

describe("computeNextRetryAt", () => {
  const HOUR = 60 * 60 * 1_000;

  it("failureCount 1 → ~1 hour from now", () => {
    const t = computeNextRetryAt(1);
    expect(t.getTime()).toBeGreaterThan(Date.now() + 0.9 * HOUR);
    expect(t.getTime()).toBeLessThan(Date.now() + 1.1 * HOUR);
  });

  it("failureCount 2 → ~6 hours from now", () => {
    const t = computeNextRetryAt(2);
    expect(t.getTime()).toBeGreaterThan(Date.now() + 5.9 * HOUR);
    expect(t.getTime()).toBeLessThan(Date.now() + 6.1 * HOUR);
  });

  it("failureCount 3 → ~24 hours from now", () => {
    const t = computeNextRetryAt(3);
    expect(t.getTime()).toBeGreaterThan(Date.now() + 23.9 * HOUR);
    expect(t.getTime()).toBeLessThan(Date.now() + 24.1 * HOUR);
  });

  it("failureCount >= 4 → ~72 hours from now", () => {
    const t = computeNextRetryAt(4);
    expect(t.getTime()).toBeGreaterThan(Date.now() + 71.9 * HOUR);
    expect(t.getTime()).toBeLessThan(Date.now() + 72.1 * HOUR);

    const t5 = computeNextRetryAt(5);
    expect(t5.getTime()).toBeGreaterThan(Date.now() + 71.9 * HOUR);
  });

  it("repeated temporary failures produce increasing nextRetryAt", () => {
    const r1 = classifyWorkdayFailure({ httpStatus: 500, failureCount: 0 });
    const r2 = classifyWorkdayFailure({ httpStatus: 500, failureCount: 1 });
    const r3 = classifyWorkdayFailure({ httpStatus: 500, failureCount: 2 });
    expect(r2.nextRetryAt!.getTime()).toBeGreaterThan(r1.nextRetryAt!.getTime());
    expect(r3.nextRetryAt!.getTime()).toBeGreaterThan(r2.nextRetryAt!.getTime());
  });
});

// ── 9. Metadata serialization ─────────────────────────────────────────────────

describe("parseWorkdayMeta / serializeWorkdayMeta", () => {
  it("returns defaults for null metadata", () => {
    const m = parseWorkdayMeta({ metadata: null });
    expect(m.verificationStatus).toBe("unverified");
    expect(m.failureCount).toBe(0);
    expect(m.highPriority).toBe(false);
  });

  it("round-trips metadata correctly", () => {
    const src = { metadata: null };
    const serialized = serializeWorkdayMeta(src, { verificationStatus: "api_valid", lastJobCount: 99 });
    const parsed = parseWorkdayMeta({ metadata: serialized });
    expect(parsed.verificationStatus).toBe("api_valid");
    expect(parsed.lastJobCount).toBe(99);
  });

  it("merges new fields on top of existing metadata", () => {
    const existing = JSON.stringify({ workday: { verificationStatus: "wrong_site_slug", failureCount: 3, highPriority: true } });
    const updated = serializeWorkdayMeta({ metadata: existing }, { verificationStatus: "api_valid", failureCount: 0 });
    const parsed = parseWorkdayMeta({ metadata: updated });
    expect(parsed.verificationStatus).toBe("api_valid");
    expect(parsed.failureCount).toBe(0);
    expect(parsed.highPriority).toBe(true); // preserved from previous
  });
});

// ── 10. buildWorkdaySourceUpdate — manually disabled sources ──────────────────

describe("buildWorkdaySourceUpdate", () => {
  it("does NOT re-enable a manually disabled source", () => {
    const source: SourceLike = {
      metadata: JSON.stringify({ workday: { manuallyDisabled: true } }),
      enabled:  false,
    };
    const classification = classifyWorkdayFailure({ httpStatus: 200, body: VALID_BODY });
    const update = buildWorkdaySourceUpdate(source, classification);
    expect(update.enabled).toBe(false); // must stay disabled
    expect(update.verificationStatus).toBe("api_valid");
  });

  it("enables a normal source when api_valid", () => {
    const update = buildWorkdaySourceUpdate(
      EMPTY_SOURCE,
      classifyWorkdayFailure({ httpStatus: 200, body: VALID_BODY }),
    );
    expect(update.enabled).toBe(true);
    expect(update.verificationStatus).toBe("api_valid");
  });

  it("disables source for wrong_site_slug", () => {
    const update = buildWorkdaySourceUpdate(
      EMPTY_SOURCE,
      classifyWorkdayFailure({ httpStatus: 422 }),
    );
    expect(update.enabled).toBe(false);
    expect(update.verificationStatus).toBe("wrong_site_slug");
    expect(update.nextRetryAt).toBeNull();
  });

  it("sets nextRetryAt for temporary_failure", () => {
    const update = buildWorkdaySourceUpdate(
      EMPTY_SOURCE,
      classifyWorkdayFailure({ httpStatus: 500, failureCount: 0 }),
    );
    expect(update.nextRetryAt).not.toBeNull();
    expect(update.enabled).toBe(true);
  });

  it("increments failure count on each failure", () => {
    const source1: SourceLike = { metadata: null, enabled: true };
    const cl = classifyWorkdayFailure({ httpStatus: 500, failureCount: 0 });

    const upd1 = buildWorkdaySourceUpdate(source1, cl);
    const meta1 = parseWorkdayMeta({ metadata: upd1.metadata });
    expect(meta1.failureCount).toBe(1);
    expect(meta1.consecutiveFailureCount).toBe(1);

    // Second failure using updated metadata
    const source2: SourceLike = { metadata: upd1.metadata, enabled: true };
    const upd2 = buildWorkdaySourceUpdate(source2, cl);
    const meta2 = parseWorkdayMeta({ metadata: upd2.metadata });
    expect(meta2.failureCount).toBe(2);
    expect(meta2.consecutiveFailureCount).toBe(2);
  });

  it("resets failure counts on api_valid", () => {
    const source: SourceLike = {
      metadata: JSON.stringify({ workday: { failureCount: 5, consecutiveFailureCount: 5 } }),
      enabled:  true,
    };
    const upd = buildWorkdaySourceUpdate(
      source,
      classifyWorkdayFailure({ httpStatus: 200, body: VALID_BODY }),
      { lastJobCount: 10 },
    );
    const meta = parseWorkdayMeta({ metadata: upd.metadata });
    expect(meta.failureCount).toBe(0);
    expect(meta.consecutiveFailureCount).toBe(0);
    expect(meta.lastJobCount).toBe(10);
  });
});

// ── 11. SYNC_EXCLUDED_STATUSES list integrity ─────────────────────────────────

describe("SYNC_EXCLUDED_STATUSES", () => {
  const MUST_EXCLUDE: WorkdayVerificationStatus[] = [
    "wrong_site_slug", "auth_blocked", "browser_required", "host_dead", "invalid_schema", "disabled",
  ];
  const MUST_INCLUDE: WorkdayVerificationStatus[] = [
    "api_valid", "scraper_valid", "temporary_failure",
  ];

  it("contains all permanently-failed statuses", () => {
    for (const s of MUST_EXCLUDE) {
      expect(SYNC_EXCLUDED_STATUSES, `expected ${s} to be excluded`).toContain(s);
    }
  });

  it("does NOT exclude statuses that should still sync", () => {
    for (const s of MUST_INCLUDE) {
      expect(SYNC_EXCLUDED_STATUSES, `expected ${s} NOT to be excluded`).not.toContain(s);
    }
  });
});
