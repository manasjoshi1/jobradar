#!/usr/bin/env node
/**
 * npm run seed:companies -- --file ./data/jobradar_master_deduped.yaml [--dry-run|--apply]
 *
 * Idempotently seeds JobSource rows from a YAML company list.
 *
 * YAML expected shape (per entry under `companies:`):
 *   name:               string  — company display name
 *   website:            string? — company homepage / career page URL
 *   category:           string? — e.g. "fintech", "saas"
 *   location:           string? — HQ location
 *   source:             string? — origin of this entry (for auditing)
 *   tags:               string? — comma-separated extra tags
 *   likelyProvider:     string? — e.g. "lever", "greenhouse", "workday"
 *   likelyBoardToken:   string? — board-specific token / subdomain
 *   confidence:         string? — "high" | "medium" | "low"
 *
 * Match priority (in order):
 *   1. provider + boardToken  (both non-null)
 *   2. normalised domain      (extracted from website)
 *   3. normalised name        (company display name)
 *
 * Field mapping:
 *   name            → company
 *   likelyProvider  → provider
 *   likelyBoardToken→ boardToken
 *   website / derived board URL → url  (must be unique)
 *   confidence      → priority  (high=1, medium=2, low=3, unknown=5)
 *   category/location/source/tags → stored as JSON in the `tags` field
 *
 * Modes:
 *   --dry-run  (default) — print counts, no DB writes
 *   --apply             — write to DB
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { PrismaClient } from '@prisma/client';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const _fileIdx = args.indexOf('--file');
const fileArg  = _fileIdx >= 0 ? args[_fileIdx + 1] : null;
const isDryRun = !args.includes('--apply');

if (!fileArg) {
  console.error('Usage: node scripts/seed-companies.mjs --file <path> [--dry-run|--apply]');
  process.exit(1);
}

const filePath = resolve(fileArg);
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// ── Load js-yaml ──────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  console.error('js-yaml not installed. Run: npm install js-yaml');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Confidence string → numeric priority */
function confidenceToPriority(c) {
  switch ((c ?? '').toLowerCase().trim()) {
    case 'high':   return 1;
    case 'medium': return 2;
    case 'low':    return 3;
    default:       return 5;
  }
}

/** Normalise a company name for fuzzy matching */
function normaliseName(name) {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract hostname from a URL, stripping www. prefix */
function normaliseDomain(url) {
  if (!url) return null;
  try {
    const raw = url.startsWith('http') ? url : `https://${url}`;
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host.toLowerCase();
  } catch {
    return null;
  }
}

/** Build a canonical job-board URL from provider + boardToken */
function buildBoardUrl(provider, boardToken, website) {
  const p = (provider ?? '').toLowerCase().trim();
  const t = (boardToken ?? '').trim();

  if (t) {
    switch (p) {
      case 'lever':           return `https://jobs.lever.co/${t}`;
      case 'greenhouse':      return `https://boards.greenhouse.io/${t}`;
      case 'ashby':           return `https://jobs.ashbyhq.com/${t}`;
      case 'smartrecruiters': return `https://careers.smartrecruiters.com/${t}`;
      case 'bamboohr':        return `https://${t}.bamboohr.com/careers`;
      case 'icims':           return website ?? `https://${t}.jobs.net`;
      case 'workday':         return website ?? `https://${t}.wd1.myworkdayjobs.com`;
      case 'jobvite':         return website ?? `https://jobs.jobvite.com/${t}`;
      case 'taleo':           return website ?? `https://${t}.taleo.net/careersection`;
      case 'rippling':        return `https://ats.rippling.com/${t}`;
      case 'dover':           return `https://app.dover.com/jobs/${t}`;
      case 'gem':             return `https://jobs.gem.com/${t}`;
      case 'pinpointhq':      return `https://${t}.pinpointhq.com`;
      case 'recruitee':       return `https://${t}.recruitee.com`;
      case 'breezy':          return `https://${t}.breezy.hr`;
      case 'workable':        return `https://apply.workable.com/${t}`;
      case 'teamtailor':      return `https://${t}.teamtailor.com/jobs`;
      case 'personio':        return `https://${t}.jobs.personio.com`;
      default:                break;
    }
  }

  // Fallback: use website, or a placeholder
  return website ?? null;
}

/** Merge old tag JSON with new metadata (non-destructive) */
function mergeTags(existingTagsJson, meta) {
  let existing = {};
  try { existing = JSON.parse(existingTagsJson ?? '{}'); } catch {}
  return JSON.stringify({ ...existing, ...meta });
}

// ── Parse YAML ────────────────────────────────────────────────────────────────

console.log(`\n📂 Loading: ${filePath}`);
const raw = readFileSync(filePath, 'utf8');
const doc = yaml.load(raw);

const companies = doc?.companies ?? doc ?? [];
if (!Array.isArray(companies)) {
  console.error('Expected YAML root key "companies" to be an array, or the root itself to be an array.');
  process.exit(1);
}

console.log(`   Found ${companies.length} entries in YAML\n`);

// ── Run ───────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

const counts = { insert: 0, update: 0, skip: 0, invalid: 0, error: 0 };
const log = { inserts: [], updates: [], skips: [], invalids: [] };

async function main() {
  // Pre-load all existing sources for fast matching
  const existing = await prisma.jobSource.findMany({
    select: { id: true, company: true, provider: true, boardToken: true, url: true, tags: true },
  });

  // Build lookup maps
  const byProviderToken = new Map(); // `${provider}::${boardToken}` → source
  const byDomain        = new Map(); // domain → source
  const byNormName      = new Map(); // normalised name → source

  for (const s of existing) {
    if (s.provider && s.boardToken) {
      byProviderToken.set(`${s.provider.toLowerCase()}::${s.boardToken.toLowerCase()}`, s);
    }
    const domain = normaliseDomain(s.url);
    if (domain) byDomain.set(domain, s);
    const nn = normaliseName(s.company);
    if (nn) byNormName.set(nn, s);
  }

  // Track URLs we'll insert so we can detect intra-batch duplicates
  const usedUrls = new Set(existing.map((s) => s.url));

  for (const entry of companies) {
    const name     = (entry.name ?? '').trim();
    const website  = (entry.website ?? '').trim() || null;
    const provider = (entry.likelyProvider ?? '').trim().toLowerCase() || null;
    const boardToken = (entry.likelyBoardToken ?? '').toString().trim() || null;
    const category = (entry.category ?? '').trim() || null;
    const location = (entry.location ?? '').trim() || null;
    const seedSrc  = (entry.source ?? '').trim() || null;
    const rawTags  = (entry.tags ?? '').trim() || null;
    const confidence = (entry.confidence ?? '').trim() || null;

    if (!name) {
      counts.invalid++;
      log.invalids.push({ entry, reason: 'missing name' });
      continue;
    }

    const priority  = confidenceToPriority(confidence);
    const boardUrl  = buildBoardUrl(provider, boardToken, website);
    const meta      = { category, location, seedSource: seedSrc, confidence, rawTags };

    // Determine canonical URL (required for upsert)
    const canonUrl = boardUrl ?? website;
    if (!canonUrl) {
      counts.invalid++;
      log.invalids.push({ name, reason: 'no url (no website, no board token)' });
      continue;
    }

    // ── Find existing match ───────────────────────────────────────────────────
    let matched = null;
    let matchBy = null;

    if (provider && boardToken) {
      const key = `${provider}::${boardToken.toLowerCase()}`;
      matched = byProviderToken.get(key) ?? null;
      if (matched) matchBy = 'provider+boardToken';
    }

    if (!matched && canonUrl) {
      const dom = normaliseDomain(canonUrl);
      if (dom) { matched = byDomain.get(dom) ?? null; if (matched) matchBy = 'domain'; }
    }

    if (!matched) {
      const nn = normaliseName(name);
      matched = byNormName.get(nn) ?? null;
      if (matched) matchBy = 'normalisedName';
    }

    if (matched) {
      // ── UPDATE existing ───────────────────────────────────────────────────
      // id === 'new' means it was inserted earlier in this same batch — skip update
      if (matched.id === 'new') {
        counts.skip++;
        log.skips.push({ name, reason: 'already inserted in this batch', matchBy });
      } else {
        counts.update++;
        log.updates.push({ name, matchBy, id: matched.id });
        if (!isDryRun) {
          const newTags = mergeTags(matched.tags, meta);
          await prisma.jobSource.update({
            where: { id: matched.id },
            data: {
              company:    name,
              provider:   provider ?? matched.provider,
              boardToken: boardToken ?? matched.boardToken,
              priority,
              tags:       newTags,
            },
          });
        }
      }
    } else {
      // ── INSERT new ────────────────────────────────────────────────────────
      // Deduplicate within batch
      if (usedUrls.has(canonUrl)) {
        counts.skip++;
        log.skips.push({ name, reason: 'duplicate URL within batch', url: canonUrl });
        continue;
      }
      usedUrls.add(canonUrl);

      counts.insert++;
      log.inserts.push({ name, provider, boardToken, url: canonUrl });
      if (!isDryRun) {
        try {
          await prisma.jobSource.create({
            data: {
              company:    name,
              provider:   provider ?? 'unknown',
              boardToken: boardToken ?? null,
              url:        canonUrl,
              enabled:    true,
              priority,
              tags:       JSON.stringify(meta),
            },
          });
          // Add to lookup maps so later entries in same batch can match
          if (provider && boardToken) {
            byProviderToken.set(`${provider}::${boardToken.toLowerCase()}`, { id: 'new', company: name, provider, boardToken, url: canonUrl, tags: null });
          }
          const dom = normaliseDomain(canonUrl);
          if (dom) byDomain.set(dom, { id: 'new', company: name, provider, boardToken, url: canonUrl, tags: null });
          byNormName.set(normaliseName(name), { id: 'new', company: name, provider, boardToken, url: canonUrl, tags: null });
        } catch (err) {
          if (err.code === 'P2002') {
            // Unique constraint on url — already exists (race)
            counts.update++;
            counts.insert--;
            log.updates.push({ name, matchBy: 'url-conflict-on-insert' });
          } else {
            counts.error++;
            console.error(`  ✗ Error inserting "${name}":`, err.message);
          }
        }
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Mode    : ${isDryRun ? 'DRY RUN (no writes)' : 'APPLY'}`);
  console.log(`  File    : ${filePath}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Insert  : ${counts.insert}`);
  console.log(`  Update  : ${counts.update}`);
  console.log(`  Skip    : ${counts.skip}  (intra-batch duplicate URL)`);
  console.log(`  Invalid : ${counts.invalid}  (missing name or URL)`);
  if (counts.error > 0) console.log(`  Errors  : ${counts.error}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Verbose details for invalids
  if (log.invalids.length > 0) {
    console.log('⚠️  Invalid entries:');
    for (const i of log.invalids) console.log(`   - ${i.name ?? JSON.stringify(i.entry)}: ${i.reason}`);
    console.log();
  }

  if (isDryRun) {
    console.log('💡 To write changes, re-run with --apply');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
