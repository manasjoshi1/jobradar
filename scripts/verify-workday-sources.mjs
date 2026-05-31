#!/usr/bin/env node
/**
 * scripts/verify-workday-sources.mjs
 *
 * Verifies Workday JobSource rows independently of the normal hourly sync.
 * Tests each CXS endpoint, classifies the result, updates DB metadata,
 * and writes a CSV report.
 *
 * Usage:
 *   node scripts/verify-workday-sources.mjs
 *   node scripts/verify-workday-sources.mjs --only-unverified
 *   node scripts/verify-workday-sources.mjs --only-failed
 *   node scripts/verify-workday-sources.mjs --company "Palo Alto Networks"
 *   node scripts/verify-workday-sources.mjs --limit=50
 *   node scripts/verify-workday-sources.mjs --force          # re-verify all
 *   node scripts/verify-workday-sources.mjs --dry-run        # no DB writes
 *   node scripts/verify-workday-sources.mjs --concurrency=5
 *   node scripts/verify-workday-sources.mjs --csv=report.csv
 */

import { PrismaClient } from "@prisma/client";
import { createWriteStream } from "fs";
import { resolve } from "path";

const prisma = new PrismaClient();
const args   = process.argv.slice(2);

const DRY_RUN       = args.includes("--dry-run");
const FORCE         = args.includes("--force");
const ONLY_UNVERIFIED = args.includes("--only-unverified");
const ONLY_FAILED   = args.includes("--only-failed");
const LIMIT         = (() => { const l = args.find(a => a.startsWith("--limit="));       return l ? parseInt(l.split("=")[1], 10) : Infinity; })();
const CONCURRENCY   = (() => { const c = args.find(a => a.startsWith("--concurrency=")); return c ? parseInt(c.split("=")[1], 10) : 3; })();
const CSV_FILE      = (() => { const c = args.find(a => a.startsWith("--csv="));         return c ? c.split("=").slice(1).join("=") : null; })();
const COMPANY_FILTER = (() => { const i = args.indexOf("--company"); return i >= 0 ? args[i + 1] : null; })();
const TIMEOUT_MS    = 15_000;

// ── Backoff & classification helpers (mirror lifecycle.ts logic) ─────────────

function computeNextRetryAt(failureCount) {
  const HOURS = [1, 6, 24, 72];
  const h = HOURS[Math.min(failureCount - 1, HOURS.length - 1)];
  return new Date(Date.now() + h * 60 * 60 * 1_000);
}

function parseWorkdayMeta(source) {
  if (!source.metadata) return {};
  try {
    const p = JSON.parse(source.metadata);
    return p?.workday ?? p ?? {};
  } catch { return {}; }
}

function classify(httpStatus, body, error, failureCount, highPriority) {
  const nextCount = (failureCount ?? 0) + 1;

  if (error && !httpStatus) {
    const msg = error.message?.toLowerCase() ?? "";
    const isDns = msg.includes("getaddrinfo") || msg.includes("enotfound") || msg.includes("dns");
    if (isDns) return { status: "host_dead",         action: "disable_host_dead",          syncEnabled: false, nextRetryAt: null, message: `DNS: ${error.message}` };
    return     { status: "temporary_failure",         action: "temporary_backoff",           syncEnabled: true,  nextRetryAt: computeNextRetryAt(nextCount), message: `Network: ${error.message}` };
  }

  if (httpStatus === 200) {
    const ok = body && typeof body.total === "number" && Array.isArray(body.jobPostings);
    if (ok) return { status: "api_valid",             action: "keep_api",                   syncEnabled: true,  nextRetryAt: null, message: `${body.jobPostings.length} job(s) on page 1` };
    return         { status: "invalid_schema",         action: "disable_invalid_schema",      syncEnabled: false, nextRetryAt: null, message: "200 but missing total/jobPostings" };
  }
  if (httpStatus === 401) return { status: "auth_blocked",         action: "disable_auth_blocked",       syncEnabled: false, nextRetryAt: null, message: "HTTP 401" };
  if (httpStatus === 403) return { status: "browser_required",     action: highPriority ? "queue_scraper_candidate" : "disable_browser_required", syncEnabled: false, nextRetryAt: null, message: "HTTP 403" };
  if (httpStatus === 404) return { status: "host_dead",            action: "disable_host_dead",          syncEnabled: false, nextRetryAt: null, message: "HTTP 404" };
  if (httpStatus === 422) return { status: "wrong_site_slug",      action: "queue_slug_discovery",       syncEnabled: false, nextRetryAt: null, message: "HTTP 422" };
  if (httpStatus === 429) return { status: "temporary_failure",    action: "temporary_backoff",           syncEnabled: true,  nextRetryAt: computeNextRetryAt(nextCount), message: "HTTP 429" };
  if (httpStatus >= 500)  return { status: "temporary_failure",    action: "temporary_backoff",           syncEnabled: true,  nextRetryAt: computeNextRetryAt(nextCount), message: `HTTP ${httpStatus}` };
  return                         { status: "temporary_failure",    action: "temporary_backoff",           syncEnabled: true,  nextRetryAt: computeNextRetryAt(nextCount), message: `Unknown ${httpStatus}` };
}

async function probeUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "JobRadarVerify/1.0" },
      body:    JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    const status = res.status;
    if (!res.ok) return { status, body: null, error: null };
    let body = null;
    try {
      const text = await res.text();
      if (!text.trimStart().startsWith("<")) body = JSON.parse(text);
    } catch {}
    return { status, body, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { status: null, body: null, error: err };
  }
}

// ── CSV writer ────────────────────────────────────────────────────────────────

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = "company,url,statusCode,classification,total,action,nextRetryAt,error\n";

// ── Build DB query ────────────────────────────────────────────────────────────

function buildWhere() {
  const base = { provider: "WORKDAY" };
  if (COMPANY_FILTER) return { ...base, company: { contains: COMPANY_FILTER } };

  if (ONLY_UNVERIFIED) return { ...base, OR: [{ verificationStatus: null }, { verificationStatus: "unverified" }] };
  if (ONLY_FAILED)     return { ...base, verificationStatus: { in: ["wrong_site_slug","auth_blocked","browser_required","host_dead","invalid_schema","temporary_failure"] } };
  if (!FORCE)          return base; // all Workday sources
  return base;
}

// ── Process one source ────────────────────────────────────────────────────────

async function processSource(source, csvStream) {
  const meta = parseWorkdayMeta(source);

  // Skip manually disabled unless --force
  if (meta.manuallyDisabled && !FORCE) {
    const row = [source.company, source.url, "", "manually_disabled", "", "no_change", "", ""].map(csvEscape).join(",");
    csvStream?.write(row + "\n");
    process.stdout.write(`  ⏭  ${source.company} — manually disabled (skipped)\n`);
    return;
  }

  const { status, body, error } = await probeUrl(source.url);
  const cl = classify(status, body, error, meta.consecutiveFailureCount ?? 0, meta.highPriority ?? false);
  const total = body?.total ?? (body?.jobPostings?.length ?? "");

  // CSV row
  const row = [
    source.company, source.url, status ?? "", cl.status, total, cl.action,
    cl.nextRetryAt ? cl.nextRetryAt.toISOString() : "",
    error?.message ?? "",
  ].map(csvEscape).join(",");
  csvStream?.write(row + "\n");

  const icon = cl.status === "api_valid" ? "✅" : cl.status === "temporary_failure" ? "⏳" : "❌";
  process.stdout.write(`  ${icon}  ${source.company} — ${cl.status} (HTTP ${status ?? "err"}) → ${cl.action}\n`);

  if (DRY_RUN) return;

  // Build updated metadata
  const now       = new Date();
  const isOk      = cl.status === "api_valid";
  const updMeta   = {
    ...meta,
    verificationStatus:      cl.status,
    fetchStrategy:           isOk ? "API" : cl.syncEnabled ? "API" : "DISABLED",
    lastStatusCode:          status ?? null,
    lastVerifiedAt:          now.toISOString(),
    lastError:               error?.message ?? null,
    lastJobCount:            typeof total === "number" ? total : null,
    ...(isOk
      ? { failureCount: 0, consecutiveFailureCount: 0, lastSuccessfulSyncAt: now.toISOString() }
      : {
          failureCount:            (meta.failureCount ?? 0) + 1,
          consecutiveFailureCount: (meta.consecutiveFailureCount ?? 0) + 1,
          lastFailedSyncAt:        now.toISOString(),
        }),
  };

  await prisma.jobSource.update({
    where: { id: source.id },
    data: {
      enabled:            cl.syncEnabled && !meta.manuallyDisabled,
      verificationStatus: cl.status,
      fetchStrategy:      updMeta.fetchStrategy,
      nextRetryAt:        cl.nextRetryAt,
      metadata:           JSON.stringify({ workday: updMeta }),
      lastSyncAt:         now,
      lastSyncStatus:     isOk ? `OK: ${total} jobs` : `${cl.status}: ${cl.message}`,
    },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const where  = buildWhere();
  const total  = await prisma.jobSource.count({ where });
  const take   = LIMIT < Infinity ? LIMIT : undefined;
  const sources = await prisma.jobSource.findMany({ where, take, orderBy: { company: "asc" } });

  console.log(`\n🔍  Verify Workday sources: ${sources.length}/${total} (dry-run=${DRY_RUN} force=${FORCE})\n`);

  // Open CSV
  let csvStream = null;
  if (CSV_FILE) {
    csvStream = createWriteStream(resolve(CSV_FILE));
    csvStream.write(CSV_HEADER);
    console.log(`📄  CSV → ${resolve(CSV_FILE)}\n`);
  }

  // Process in batches of CONCURRENCY
  const stats = {};
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(s => processSource(s, csvStream)));
  }

  if (csvStream) await new Promise(r => csvStream.end(r));

  // Print summary
  const summary = await prisma.jobSource.groupBy({
    by: ["verificationStatus"],
    where: { provider: "WORKDAY" },
    _count: { id: true },
  });

  console.log("\n── Workday source summary ───────────────────────────────────────");
  for (const row of summary.sort((a,b) => (b._count.id - a._count.id))) {
    console.log(`  ${(row.verificationStatus ?? "unverified").padEnd(22)} ${row._count.id}`);
  }
  console.log("─────────────────────────────────────────────────────────────────\n");

  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
