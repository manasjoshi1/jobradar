#!/usr/bin/env node
/**
 * scripts/discover-workday-site-slugs.mjs
 *
 * Runs ONLY against sources with verificationStatus = "wrong_site_slug".
 * Attempts to discover the correct site slug by:
 *   1. Following the /en-US/ HTTP redirect (Workday redirects to /en-US/{site})
 *   2. Trying a small set of common slug patterns
 *
 * If the correct slug is found:
 *   - Updates source URL to the correct CXS endpoint
 *   - Sets verificationStatus = api_valid, fetchStrategy = API, enabled = true
 *
 * If not found:
 *   - Updates lastVerifiedAt, keeps source disabled
 *   - Does NOT re-enable or put source back into normal sync
 *
 * Usage:
 *   node scripts/discover-workday-site-slugs.mjs
 *   node scripts/discover-workday-site-slugs.mjs --limit=20
 *   node scripts/discover-workday-site-slugs.mjs --company "Palo Alto Networks"
 *   node scripts/discover-workday-site-slugs.mjs --dry-run
 *   node scripts/discover-workday-site-slugs.mjs --concurrency=5
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args   = process.argv.slice(2);

const DRY_RUN       = args.includes("--dry-run");
const LIMIT         = (() => { const l = args.find(a => a.startsWith("--limit="));       return l ? parseInt(l.split("=")[1], 10) : Infinity; })();
const CONCURRENCY   = (() => { const c = args.find(a => a.startsWith("--concurrency=")); return c ? parseInt(c.split("=")[1], 10) : 3; })();
const COMPANY_FILTER = (() => { const i = args.indexOf("--company"); return i >= 0 ? args[i + 1] : null; })();
const TIMEOUT_MS    = 12_000;

// ── Slug discovery ────────────────────────────────────────────────────────────

function tenantFromUrl(url) {
  try { return new URL(url).hostname.split(".")[0]; } catch { return ""; }
}

function hostFromUrl(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

/**
 * Attempt to discover the Workday site slug by following /en-US/ redirect.
 */
async function discoverViaRedirect(host) {
  try {
    const res = await fetch(`https://${host}/en-US/`, {
      redirect: "follow",
      signal:   AbortSignal.timeout(TIMEOUT_MS),
      headers:  { "User-Agent": "JobRadarDiscover/1.0" },
    });
    const final = res.url;
    const m = final.match(/\/en-US\/([^\/\?#]+)/);
    const slug = m?.[1];
    if (slug && slug.toLowerCase() !== "jobsearch" && slug.toLowerCase() !== "search") {
      return slug;
    }
  } catch { /* timeout/DNS — fall through */ }
  return null;
}

/** Common slug patterns to try when redirect fails. */
function slugCandidates(tenant) {
  return [
    "External",
    "Careers",
    "ExternalCareers",
    "External_Career_Site",
    "ExternalCareerSite",
    `${tenant}Careers`,
    `${tenant}ExternalCareerSite`,
    `${tenant}_External`,
    "Jobs",
    "JobSearch",
  ];
}

async function probeApiSlug(host, tenant, slug) {
  const url = `https://${host}/wday/cxs/${tenant}/${slug}/jobs`;
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "JobRadarDiscover/1.0" },
      body:    JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (json && typeof json.total === "number" && Array.isArray(json.jobPostings)) {
      return { url, total: json.total };
    }
  } catch {}
  return null;
}

async function findSlug(source) {
  const host   = hostFromUrl(source.url);
  const tenant = tenantFromUrl(source.url);
  if (!host || !tenant) return null;

  // 1. Try redirect
  const slugFromRedirect = await discoverViaRedirect(host);
  if (slugFromRedirect) {
    const hit = await probeApiSlug(host, tenant, slugFromRedirect);
    if (hit) return hit;
  }

  // 2. Try common patterns
  for (const slug of slugCandidates(tenant)) {
    const hit = await probeApiSlug(host, tenant, slug);
    if (hit) return hit;
  }

  return null;
}

function parseWorkdayMeta(source) {
  if (!source.metadata) return {};
  try { const p = JSON.parse(source.metadata); return p?.workday ?? p ?? {}; } catch { return {}; }
}

// ── Process one source ────────────────────────────────────────────────────────

async function processSource(source) {
  const meta = parseWorkdayMeta(source);

  process.stdout.write(`  ${source.company} (${hostFromUrl(source.url)})… `);

  const found = await findSlug(source);

  if (!found) {
    console.log("❌  slug not found — keeping disabled");
    if (!DRY_RUN) {
      const now = new Date();
      await prisma.jobSource.update({
        where: { id: source.id },
        data: {
          metadata: JSON.stringify({ workday: { ...meta, lastVerifiedAt: now.toISOString() } }),
          lastSyncAt: now,
          lastSyncStatus: "wrong_site_slug: slug discovery failed",
        },
      });
    }
    return { result: "not_found" };
  }

  console.log(`✅  slug found → ${found.url}  (${found.total} jobs)`);

  if (DRY_RUN) return { result: "would_fix", url: found.url };

  const now = new Date();
  const updatedMeta = {
    ...meta,
    verificationStatus:      "api_valid",
    fetchStrategy:           "API",
    lastStatusCode:          200,
    lastVerifiedAt:          now.toISOString(),
    lastSuccessfulSyncAt:    now.toISOString(),
    failureCount:            0,
    consecutiveFailureCount: 0,
    lastError:               null,
    lastJobCount:            found.total,
  };

  // Check for existing source with this URL to avoid UNIQUE constraint violation
  const existing = await prisma.jobSource.findUnique({ where: { url: found.url } });
  if (existing && existing.id !== source.id) {
    console.log(`  ⚠️  URL ${found.url} already exists (id=${existing.id}) — merging metadata only`);
    await prisma.jobSource.update({
      where: { id: source.id },
      data: { enabled: false, verificationStatus: "disabled", metadata: JSON.stringify({ workday: { ...meta, disabledReason: `duplicate of ${existing.id}`, lastVerifiedAt: now.toISOString() } }) },
    });
    return { result: "duplicate" };
  }

  await prisma.jobSource.update({
    where: { id: source.id },
    data: {
      url:               found.url,
      enabled:           true,
      verificationStatus: "api_valid",
      fetchStrategy:     "API",
      nextRetryAt:       null,
      metadata:          JSON.stringify({ workday: updatedMeta }),
      lastSyncAt:        now,
      lastSyncStatus:    `OK: slug discovered (${found.total} jobs)`,
    },
  });

  return { result: "fixed", url: found.url };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const where = {
    provider:           "WORKDAY",
    verificationStatus: "wrong_site_slug",
    ...(COMPANY_FILTER ? { company: { contains: COMPANY_FILTER } } : {}),
  };

  const total   = await prisma.jobSource.count({ where });
  const take    = LIMIT < Infinity ? LIMIT : undefined;
  const sources = await prisma.jobSource.findMany({ where, take, orderBy: { company: "asc" } });

  console.log(`\n🔍  Slug discovery: ${sources.length}/${total} wrong_site_slug sources (dry-run=${DRY_RUN})\n`);

  const stats = { fixed: 0, not_found: 0, duplicate: 0, "would_fix": 0 };

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch   = sources.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(processSource));
    results.forEach(r => { if (r?.result) stats[r.result] = (stats[r.result] ?? 0) + 1; });
  }

  console.log(`\n✅  Done — fixed=${stats.fixed}  not_found=${stats.not_found}  duplicate=${stats.duplicate}  would_fix=${stats["would_fix"]}\n`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
