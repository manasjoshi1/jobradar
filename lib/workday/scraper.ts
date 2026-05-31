/**
 * lib/workday/scraper.ts
 *
 * Playwright-based Workday scraper with two modes:
 *
 *   1. Browser-assisted API discovery  (preferred)
 *      Open the public careers page, watch network traffic for the hidden
 *      CXS /wday/cxs/.../jobs endpoint. If found + directly POST-able, the
 *      caller switches the source back to API mode.
 *
 *   2. DOM fallback scraping            (last resort)
 *      Only when no usable CXS endpoint is discovered. Extracts jobs from the
 *      rendered page via data-automation-id selectors, with pagination /
 *      infinite-scroll support.
 *
 * Conservative by design:
 *   - Public pages only — no credentials, no CAPTCHA bypass, no stealth.
 *   - Detects auth/CAPTCHA/Cloudflare walls → classifies browser_blocked.
 *   - Respects WORKDAY_SCRAPER_ENABLED and per-source eligibility.
 *
 * Env vars:
 *   WORKDAY_SCRAPER_ENABLED      — master switch        (default: false)
 *   WORKDAY_SCRAPER_MAX_PAGES    — DOM pagination cap    (default: 3)
 *   WORKDAY_SCRAPER_MAX_SCROLLS  — infinite-scroll cap   (default: 5)
 *   WORKDAY_SCRAPER_TIMEOUT_MS   — per-page nav timeout  (default: 30000)
 */

import type { Browser, Page } from "playwright";
import type { NormalizedJob } from "../types";
import {
  parseCxsUrl,
  buildPublicPageUrl,
  normalizeWorkdayApiJob,
  normalizeWorkdayDomJob,
  type CxsParts,
} from "./parse";

// ── Config ────────────────────────────────────────────────────────────────────

export const WORKDAY_SCRAPER_ENABLED = process.env.WORKDAY_SCRAPER_ENABLED === "true";
const MAX_PAGES   = Math.max(1, parseInt(process.env.WORKDAY_SCRAPER_MAX_PAGES   ?? "3",  10) || 3);
const MAX_SCROLLS = Math.max(1, parseInt(process.env.WORKDAY_SCRAPER_MAX_SCROLLS ?? "5",  10) || 5);
const TIMEOUT_MS  = Math.max(5_000, parseInt(process.env.WORKDAY_SCRAPER_TIMEOUT_MS ?? "30000", 10) || 30_000);

// ── Result types ────────────────────────────────────────────────────────────

export type ScrapeMode = "api_discovered" | "dom" | "blocked" | "empty";

export type CxsDiscovery = {
  /** The discovered CXS endpoint, verified by a direct POST */
  apiUrl: string;
  parts:  CxsParts;
  total:  number;
};

export type ScrapeResult = {
  mode:        ScrapeMode;
  jobs:        NormalizedJob[];
  /** Present when discovery found a directly-POST-able CXS endpoint */
  discovery?:  CxsDiscovery;
  /** Reason for "blocked" mode */
  blockReason?: string;
};

// ── Block detection ───────────────────────────────────────────────────────────

const BLOCK_PATTERNS = [
  "captcha", "verify you are human", "access denied", "sign in",
  "log in", "login", "authentication required", "forbidden",
  "are you a robot", "checking your browser",
];

function detectBlock(html: string): string | null {
  const lower = html.toLowerCase();
  for (const p of BLOCK_PATTERNS) {
    if (lower.includes(p)) return p;
  }
  return null;
}

// ── Direct CXS probe (Node fetch — not browser) ───────────────────────────────

async function probeCxsDirect(apiUrl: string): Promise<{ ok: boolean; total: number }> {
  try {
    const res = await fetch(apiUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "JobRadarScraper/1.0" },
      body:    JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, total: 0 };
    const json = await res.json().catch(() => null);
    if (json && Number.isFinite(Number(json.total)) && Array.isArray(json.jobPostings)) {
      return { ok: true, total: Number(json.total) };
    }
  } catch { /* ignore */ }
  return { ok: false, total: 0 };
}

// ── DOM extraction (runs in browser context) ──────────────────────────────────

/**
 * Extract job cards from the current page. Returns raw objects; normalization
 * happens in Node. This function body is serialized and executed in the browser,
 * so it must be self-contained (no external references).
 */
type RawDomJobRow = { title: string; location?: string; postedOn?: string; applyUrl: string; reqId?: string };

/**
 * The DOM-extraction code is passed to page.evaluate as a STRING, not a function.
 * This is deliberate: bundlers (esbuild/tsx/SWC) inject helper calls like
 * `__name(...)` into serialized functions with `keepNames`, which throw
 * "__name is not defined" in the browser context. A string body is immune.
 */
const EXTRACT_JOBS_SCRIPT = `
(() => {
  var text = function (el) { return (el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : ""); };
  var absoluteUrl = function (href) {
    if (!href) return "";
    try { return new URL(href, window.location.origin).toString(); } catch (e) { return ""; }
  };

  var links = Array.prototype.slice.call(document.querySelectorAll('a[href*="/job/"]'));
  var seen = {};
  var out = [];

  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    var applyUrl = absoluteUrl(link.getAttribute("href"));
    if (!applyUrl || seen[applyUrl]) continue;
    seen[applyUrl] = true;

    var container =
      link.closest('[data-automation-id="jobPosting"]') ||
      link.closest('[data-automation-id="jobCard"]') ||
      link.closest('[data-automation-id="jobSearchResult"]') ||
      link.closest('[data-automation-id="jobResult"]') ||
      link.closest('[role="listitem"]') ||
      link.closest("li") ||
      link.closest("article") ||
      link.parentElement;

    var q = function (sel) { return container ? container.querySelector(sel) : null; };

    var title =
      text(q('[data-automation-id="jobTitle"]')) ||
      text(q('[data-automation-id="jobPostingHeader"]')) ||
      text(q('[data-automation-id="job-title"]')) ||
      text(q("h2")) || text(q("h3")) || text(link);

    var location =
      text(q('[data-automation-id="locations"]')) ||
      text(q('[data-automation-id="location"]')) ||
      text(q('[data-automation-id="jobLocation"]')) || "";

    var postedOn =
      text(q('[data-automation-id="postedOn"]')) ||
      text(q('[data-automation-id="posted-date"]')) ||
      text(q('[data-automation-id="datePosted"]')) || "";
    if (!postedOn && container) {
      var all = Array.prototype.slice.call(container.querySelectorAll("*"));
      for (var k = 0; k < all.length; k++) {
        var t = text(all[k]);
        if (/posted\\s+(today|yesterday|\\d+\\s+(day|days|week|weeks|month|months)\\s+ago)|^\\d+\\s+(day|days|week|weeks)\\s+ago/i.test(t)) {
          postedOn = t; break;
        }
      }
    }

    var reqId =
      text(q('[data-automation-id="jobReqId"]')) ||
      text(q('[data-automation-id="requisitionId"]')) || "";
    if (!reqId && container) {
      var m = text(container).match(/(JR-?\\d+|R-?\\d{4,}|REQ-?\\d+)/i);
      reqId = m ? m[1] : "";
    }

    if (title) out.push({ title: title, location: location, postedOn: postedOn, applyUrl: applyUrl, reqId: reqId || undefined });
  }

  return out;
})()
`;

async function extractJobsFromPage(page: Page): Promise<RawDomJobRow[]> {
  return page.evaluate(EXTRACT_JOBS_SCRIPT) as Promise<RawDomJobRow[]>;
}

// ── DOM pagination ────────────────────────────────────────────────────────────

const NEXT_SELECTOR =
  '[data-automation-id="pagination-next"], [data-automation-id="next"], ' +
  'button[aria-label*="Next" i], button:has-text("Next"), ' +
  'button:has-text("Load More"), button:has-text("Show More")';

async function scrapePaginated(page: Page): Promise<Array<{ title: string; location?: string; postedOn?: string; applyUrl: string; reqId?: string }>> {
  const all: Array<{ title: string; location?: string; postedOn?: string; applyUrl: string; reqId?: string }> = [];
  const seen = new Set<string>();

  for (let p = 0; p < MAX_PAGES; p++) {
    const jobs = await extractJobsFromPage(page);
    for (const j of jobs) {
      if (!seen.has(j.applyUrl)) { seen.add(j.applyUrl); all.push(j); }
    }

    const nextBtn = page.locator(NEXT_SELECTOR).first();
    if ((await nextBtn.count()) === 0) break;

    const disabled = await nextBtn.getAttribute("disabled").catch(() => null);
    const ariaDis  = await nextBtn.getAttribute("aria-disabled").catch(() => null);
    if (disabled !== null || ariaDis === "true") break;

    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      nextBtn.click().catch(() => {}),
    ]);
    await page.waitForTimeout(1_500);
  }

  // If pagination yielded only one page, try infinite scroll for more
  if (all.length > 0) {
    let prevCount = all.length;
    let stagnant  = 0;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await page.waitForTimeout(1_500);
      const jobs = await extractJobsFromPage(page);
      for (const j of jobs) {
        if (!seen.has(j.applyUrl)) { seen.add(j.applyUrl); all.push(j); }
      }
      if (all.length <= prevCount) stagnant++; else stagnant = 0;
      prevCount = all.length;
      if (stagnant >= 2) break;
    }
  }

  return all;
}

// ── Main entry: scrape one source ──────────────────────────────────────────────

/**
 * Scrape a Workday source. Tries CXS discovery first, falls back to DOM.
 * The `source.url` is expected to be a CXS API URL (so we can derive the
 * public page URL). Returns a ScrapeResult — never throws on scrape failures.
 */
export async function scrapeWorkdaySource(
  source: { company: string; url: string },
): Promise<ScrapeResult> {
  const pageUrl = buildPublicPageUrl(source.url);
  if (!pageUrl) {
    return { mode: "blocked", jobs: [], blockReason: "cannot derive public page URL" };
  }

  // Lazy import so Playwright is only loaded when scraping is actually used
  const { chromium } = await import("playwright");

  let browser: Browser | null = null;
  const cxsCandidates: Array<{ url: string; total: number; postings: unknown[] }> = [];

  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; JobRadarScraper/1.0)",
    });
    const page = await ctx.newPage();

    // ── Network listener: capture CXS responses ──────────────────────────────
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/wday/cxs/") || !url.includes("/jobs")) return;
      try {
        const json = await response.json();
        if (Number.isFinite(Number(json.total)) && Array.isArray(json.jobPostings)) {
          cxsCandidates.push({ url, total: Number(json.total), postings: json.jobPostings });
        }
      } catch { /* non-JSON — ignore */ }
    });

    // ── Navigate ──────────────────────────────────────────────────────────────
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(2_000);

    // ── Block detection ─────────────────────────────────────────────────────
    const html = await page.content().catch(() => "");
    const block = detectBlock(html);
    // Only treat as blocked if we also found NO jobs/cxs (challenge pages have no real content)
    const hasJobLinks = (await page.locator('a[href*="/job/"]').count().catch(() => 0)) > 0;
    if (block && cxsCandidates.length === 0 && !hasJobLinks) {
      return { mode: "blocked", jobs: [], blockReason: block };
    }

    // ── Mode 1: API discovery ─────────────────────────────────────────────────
    if (cxsCandidates.length > 0) {
      // Prefer the candidate with the highest total
      const best = cxsCandidates.sort((a, b) => b.total - a.total)[0];
      const parts = parseCxsUrl(best.url);
      if (parts) {
        const direct = await probeCxsDirect(best.url);
        if (direct.ok) {
          // Endpoint is directly POST-able → caller will switch to API mode.
          // We still return the jobs we observed so this sync isn't wasted.
          const jobs = best.postings
            .map((p) => normalizeWorkdayApiJob(p as Record<string, unknown>, source))
            .filter((j): j is NormalizedJob => j !== null);
          return {
            mode:      "api_discovered",
            jobs,
            discovery: { apiUrl: best.url, parts, total: best.total },
          };
        }
        // Browser saw it but direct POST failed (cookie/anti-bot gated) →
        // use the browser-observed postings as scraper_valid output.
        const jobs = best.postings
          .map((p) => normalizeWorkdayApiJob(p as Record<string, unknown>, source))
          .filter((j): j is NormalizedJob => j !== null);
        if (jobs.length > 0) return { mode: "dom", jobs };
      }
    }

    // ── Mode 2: DOM fallback ──────────────────────────────────────────────────
    const rawJobs = await scrapePaginated(page);
    if (rawJobs.length === 0) {
      // Re-check for a block wall now that we know there are no jobs
      if (block) return { mode: "blocked", jobs: [], blockReason: block };
      return { mode: "empty", jobs: [] };
    }

    const jobs = rawJobs
      .map((j) => normalizeWorkdayDomJob(j, source))
      .filter((j): j is NormalizedJob => j !== null);

    return { mode: "dom", jobs };
  } catch (err) {
    return {
      mode: "blocked",
      jobs: [],
      blockReason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
