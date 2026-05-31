/**
 * __tests__/workday-parse.test.ts
 *
 * Tests for Workday parsing/normalization helpers and scraper eligibility.
 */

import { describe, it, expect } from "vitest";
import {
  parseWorkdayPostedOn,
  isWithinDays,
  parseCxsUrl,
  buildCxsUrl,
  buildApplyUrl,
  buildPublicPageUrl,
  normalizeWorkdayApiJob,
  normalizeWorkdayDomJob,
} from "../lib/workday/parse";
import { isScraperEligible } from "../lib/workday/lifecycle";

const DAY = 24 * 60 * 60 * 1_000;

// ── parseWorkdayPostedOn ──────────────────────────────────────────────────────

describe("parseWorkdayPostedOn", () => {
  function daysAgo(iso: string | undefined): number | null {
    if (!iso) return null;
    return Math.round((Date.now() - new Date(iso).getTime()) / DAY);
  }

  it("Posted Today → 0 days", () => expect(daysAgo(parseWorkdayPostedOn("Posted Today"))).toBe(0));
  it("Today → 0 days",        () => expect(daysAgo(parseWorkdayPostedOn("Today"))).toBe(0));
  it("Just Posted → 0 days",  () => expect(daysAgo(parseWorkdayPostedOn("Just Posted"))).toBe(0));
  it("Posted Yesterday → 1 day", () => expect(daysAgo(parseWorkdayPostedOn("Posted Yesterday"))).toBe(1));
  it("Yesterday → 1 day",     () => expect(daysAgo(parseWorkdayPostedOn("Yesterday"))).toBe(1));
  it("Posted 1 Day Ago → 1",  () => expect(daysAgo(parseWorkdayPostedOn("Posted 1 Day Ago"))).toBe(1));
  it("Posted 3 Days Ago → 3", () => expect(daysAgo(parseWorkdayPostedOn("Posted 3 Days Ago"))).toBe(3));
  it("3 days ago → 3",        () => expect(daysAgo(parseWorkdayPostedOn("3 days ago"))).toBe(3));
  it("Posted 1 Week Ago → 7", () => expect(daysAgo(parseWorkdayPostedOn("Posted 1 Week Ago"))).toBe(7));
  it("2 weeks ago → 14",      () => expect(daysAgo(parseWorkdayPostedOn("2 weeks ago"))).toBe(14));
  it("Posted 1 Month Ago → 30", () => expect(daysAgo(parseWorkdayPostedOn("Posted 1 Month Ago"))).toBe(30));
  it("30+ Days Ago → 30",     () => expect(daysAgo(parseWorkdayPostedOn("Posted 30+ Days Ago"))).toBe(30));
  it("empty → undefined",     () => expect(parseWorkdayPostedOn("")).toBeUndefined());
  it("null → undefined",      () => expect(parseWorkdayPostedOn(null)).toBeUndefined());
  it("gibberish → undefined", () => expect(parseWorkdayPostedOn("sometime recently")).toBeUndefined());
});

// ── isWithinDays ──────────────────────────────────────────────────────────────

describe("isWithinDays", () => {
  it("today is within 14 days", () => expect(isWithinDays(new Date().toISOString(), 14)).toBe(true));
  it("20 days ago is NOT within 14 days", () => {
    const d = new Date(Date.now() - 20 * DAY).toISOString();
    expect(isWithinDays(d, 14)).toBe(false);
  });
  it("undefined counts as recent", () => expect(isWithinDays(undefined, 14)).toBe(true));
});

// ── CXS URL helpers ───────────────────────────────────────────────────────────

describe("parseCxsUrl / buildCxsUrl / buildApplyUrl / buildPublicPageUrl", () => {
  const API = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs";

  it("parses host/tenant/site", () => {
    const p = parseCxsUrl(API);
    expect(p).toEqual({
      host:   "nvidia.wd5.myworkdayjobs.com",
      tenant: "nvidia",
      site:   "NVIDIAExternalCareerSite",
    });
  });

  it("round-trips via buildCxsUrl", () => {
    expect(buildCxsUrl(parseCxsUrl(API)!)).toBe(API);
  });

  it("builds apply URL from externalPath", () => {
    expect(buildApplyUrl(API, "/job/USA/Engineer_R123")).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/USA/Engineer_R123",
    );
  });

  it("builds public page URL", () => {
    expect(buildPublicPageUrl(API)).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite",
    );
  });

  it("returns null for non-CXS URL", () => {
    expect(parseCxsUrl("https://example.com/careers")).toBeNull();
    expect(buildPublicPageUrl("https://example.com/careers")).toBeNull();
  });
});

// ── normalizeWorkdayApiJob ────────────────────────────────────────────────────

describe("normalizeWorkdayApiJob", () => {
  const source = { company: "NVIDIA", url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs" };

  it("normalizes a full posting", () => {
    const job = normalizeWorkdayApiJob({
      title: "Senior Engineer",
      externalPath: "/job/USA/Senior-Engineer_JR100",
      locationsText: "Santa Clara, CA",
      postedOn: "Posted 2 Days Ago",
      timeType: "Full time",
      jobFamily: "Engineering",
      bulletFields: ["JR100"],
    }, source);

    expect(job).not.toBeNull();
    expect(job!.title).toBe("Senior Engineer");
    expect(job!.company).toBe("NVIDIA");
    expect(job!.employmentType).toBe("Full time");
    expect(job!.department).toBe("Engineering");
    expect(job!.externalId).toBe("JR100");
    expect(job!.applyUrl).toContain("/en-US/NVIDIAExternalCareerSite/job/USA/Senior-Engineer_JR100");
  });

  it("returns null when title missing", () => {
    expect(normalizeWorkdayApiJob({ externalPath: "/job/x" }, source)).toBeNull();
  });

  it("falls back to externalPath as externalId", () => {
    const job = normalizeWorkdayApiJob({ title: "X", externalPath: "/job/abc" }, source);
    expect(job!.externalId).toBe("/job/abc");
  });
});

// ── normalizeWorkdayDomJob ────────────────────────────────────────────────────

describe("normalizeWorkdayDomJob", () => {
  const source = { company: "ServiceNow" };

  it("normalizes a DOM job and extracts reqId from URL", () => {
    const job = normalizeWorkdayDomJob({
      title: "Staff Engineer",
      location: "San Diego, CA",
      postedOn: "Posted 5 Days Ago",
      applyUrl: "https://servicenow.wd1.myworkdayjobs.com/en-US/External/job/Staff-Engineer_JR45678",
    }, source);

    expect(job).not.toBeNull();
    expect(job!.title).toBe("Staff Engineer");
    expect(job!.externalId).toBe("JR45678");
    expect(job!.postedAt).toBeTruthy();
  });

  it("returns null when applyUrl missing", () => {
    expect(normalizeWorkdayDomJob({ title: "X", applyUrl: "" }, source)).toBeNull();
  });
});

// ── isScraperEligible (acceptance criteria 9 & 10) ────────────────────────────

describe("isScraperEligible", () => {
  type EligibilityInput = {
    enabled: boolean;
    fetchStrategy: string | null;
    verificationStatus: string | null;
    metadata: string | null;
  };
  const base: EligibilityInput = {
    enabled: true,
    fetchStrategy: "SCRAPER",
    verificationStatus: "scraper_candidate",
    metadata: null,
  };

  it("eligible when SCRAPER + scraper_candidate + enabled + flag on", () => {
    expect(isScraperEligible(base, true)).toBe(true);
  });

  it("NOT eligible when WORKDAY_SCRAPER_ENABLED is false", () => {
    expect(isScraperEligible(base, false)).toBe(false);
  });

  it("eligible for AUTO + scraper_valid", () => {
    expect(isScraperEligible({ ...base, fetchStrategy: "AUTO", verificationStatus: "scraper_valid" }, true)).toBe(true);
  });

  it("NOT eligible for fetchStrategy=API", () => {
    expect(isScraperEligible({ ...base, fetchStrategy: "API" }, true)).toBe(false);
  });

  it("NOT eligible for auth_blocked", () => {
    expect(isScraperEligible({ ...base, verificationStatus: "auth_blocked" }, true)).toBe(false);
  });

  it("NOT eligible for host_dead", () => {
    expect(isScraperEligible({ ...base, verificationStatus: "host_dead" }, true)).toBe(false);
  });

  it("NOT eligible when source disabled", () => {
    expect(isScraperEligible({ ...base, enabled: false }, true)).toBe(false);
  });

  it("NOT eligible when manuallyDisabled in metadata", () => {
    const md = JSON.stringify({ workday: { manuallyDisabled: true } });
    expect(isScraperEligible({ ...base, metadata: md }, true)).toBe(false);
  });
});
