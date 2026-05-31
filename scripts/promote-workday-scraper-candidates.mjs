#!/usr/bin/env node
/**
 * scripts/promote-workday-scraper-candidates.mjs
 *
 * Manually promotes selected Workday sources into scraper mode.
 * Scraper promotion is ALWAYS opt-in — never automatic.
 *
 * Criteria for promotion:
 *   - Company is strategically important
 *   - Career page is public (no auth/CAPTCHA)
 *   - WORKDAY_SCRAPER_ENABLED=true must be set in env
 *   - Source must have verificationStatus in (browser_required, wrong_site_slug, auth_blocked)
 *     — i.e. the API is blocked but the page may be public
 *
 * Safety guards:
 *   - Does NOT auto-promote all failed sources
 *   - Does NOT promote host_dead or invalid_schema sources
 *   - Does NOT touch manually disabled sources (without --force)
 *   - Sets fetchStrategy = SCRAPER, verificationStatus = scraper_candidate
 *   - Does NOT enable = true until a scraper validates it (scraper_valid)
 *
 * Usage:
 *   node scripts/promote-workday-scraper-candidates.mjs --company "ServiceNow"
 *   node scripts/promote-workday-scraper-candidates.mjs --company "Palo Alto Networks" --priority=high
 *   node scripts/promote-workday-scraper-candidates.mjs --list          # show candidates
 *   node scripts/promote-workday-scraper-candidates.mjs --demote --company "ServiceNow"
 *   node scripts/promote-workday-scraper-candidates.mjs --dry-run --company "ServiceNow"
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args   = process.argv.slice(2);

const DRY_RUN        = args.includes("--dry-run");
const FORCE          = args.includes("--force");
const LIST_MODE      = args.includes("--list");
const DEMOTE         = args.includes("--demote");
const COMPANY_FILTER = (() => { const i = args.indexOf("--company"); return i >= 0 ? args[i + 1] : null; })();
const HIGH_PRIORITY  = args.includes("--priority=high");

// Sources blocked from scraper promotion
const INELIGIBLE_STATUSES = ["host_dead", "invalid_schema", "disabled", "api_valid", "scraper_valid"];

function parseWorkdayMeta(source) {
  if (!source.metadata) return {};
  try { const p = JSON.parse(source.metadata); return p?.workday ?? p ?? {}; } catch { return {}; }
}

// ── List mode ─────────────────────────────────────────────────────────────────

async function listCandidates() {
  const sources = await prisma.jobSource.findMany({
    where: {
      provider: "WORKDAY",
      verificationStatus: { in: ["browser_required", "wrong_site_slug", "auth_blocked", "scraper_candidate"] },
    },
    orderBy: [{ verificationStatus: "asc" }, { company: "asc" }],
  });

  console.log(`\n📋  Workday scraper candidates (${sources.length}):\n`);
  console.log("  Status                Company                       High-priority  URL");
  console.log("  " + "─".repeat(90));
  for (const s of sources) {
    const meta = parseWorkdayMeta(s);
    const hp   = meta.highPriority ? "✓" : "";
    console.log(`  ${(s.verificationStatus ?? "").padEnd(22)} ${s.company.padEnd(30)} ${hp.padEnd(15)} ${s.url}`);
  }
  console.log("");
}

// ── Promote ───────────────────────────────────────────────────────────────────

async function promote(source) {
  const meta = parseWorkdayMeta(source);

  if (meta.manuallyDisabled && !FORCE) {
    console.log(`  ⏭  ${source.company} — manually disabled, skipping (use --force to override)`);
    return;
  }

  if (INELIGIBLE_STATUSES.includes(source.verificationStatus)) {
    console.log(`  ⚠️  ${source.company} — ineligible status "${source.verificationStatus}" — cannot promote`);
    return;
  }

  console.log(`  ✅  Promoting ${source.company} → scraper_candidate${HIGH_PRIORITY ? " (high-priority)" : ""}`);

  if (DRY_RUN) return;

  const now = new Date();
  const updatedMeta = {
    ...meta,
    verificationStatus:  "scraper_candidate",
    fetchStrategy:       "SCRAPER",
    highPriority:        HIGH_PRIORITY || meta.highPriority || false,
    lastVerifiedAt:      now.toISOString(),
  };

  await prisma.jobSource.update({
    where: { id: source.id },
    data: {
      verificationStatus: "scraper_candidate",
      fetchStrategy:      "SCRAPER",
      // DO NOT set enabled=true here — that requires scraper validation first
      nextRetryAt:        null,
      metadata:           JSON.stringify({ workday: updatedMeta }),
    },
  });
}

// ── Demote ────────────────────────────────────────────────────────────────────

async function demote(source) {
  const meta = parseWorkdayMeta(source);
  console.log(`  🔽  Demoting ${source.company} → browser_required (from ${source.verificationStatus})`);
  if (DRY_RUN) return;

  const now = new Date();
  await prisma.jobSource.update({
    where: { id: source.id },
    data: {
      verificationStatus: "browser_required",
      fetchStrategy:      "DISABLED",
      enabled:            false,
      metadata: JSON.stringify({ workday: { ...meta, verificationStatus: "browser_required", fetchStrategy: "DISABLED", lastVerifiedAt: now.toISOString() } }),
    },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (LIST_MODE) {
    await listCandidates();
    await prisma.$disconnect();
    return;
  }

  if (!COMPANY_FILTER) {
    console.error("Usage: --company <name>  or  --list");
    process.exit(1);
  }

  const sources = await prisma.jobSource.findMany({
    where: { provider: "WORKDAY", company: { contains: COMPANY_FILTER } },
  });

  if (sources.length === 0) {
    console.log(`No Workday source found matching "${COMPANY_FILTER}".`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\n${DEMOTE ? "🔽  Demoting" : "⬆️   Promoting"} ${sources.length} source(s) matching "${COMPANY_FILTER}" (dry-run=${DRY_RUN})\n`);

  for (const s of sources) {
    if (DEMOTE) await demote(s);
    else        await promote(s);
  }

  console.log("\nDone.\n");
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
