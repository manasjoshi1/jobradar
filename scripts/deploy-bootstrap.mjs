#!/usr/bin/env node
/**
 * npm run deploy:bootstrap
 *
 * Safe, idempotent bootstrap for fresh deploys AND restarts.
 * Runs in order:
 *   1. prisma migrate deploy
 *   2. config:import  (job-sources + role-profiles from YAML)
 *   3. db:backfill-effective-new-at
 *   4. runs:recover --threshold-minutes 10
 *
 * Does NOT delete jobs, recommendations, or user data.
 * Safe to run on every container start.
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function run(label, cmd) {
  console.log(`\n▶ ${label}`);
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (out.trim()) console.log(out.trim());
    return out;
  } catch (err) {
    const stderr = err.stderr?.toString().trim() ?? '';
    const stdout = err.stdout?.toString().trim() ?? '';
    // Print output but don't crash — some steps print to stderr even on success
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err.status !== 0) {
      console.error(`  ✗ "${label}" exited with code ${err.status}`);
      process.exit(err.status ?? 1);
    }
  }
}

// ── 1. Migrations ─────────────────────────────────────────────────────────────
run('prisma migrate deploy', 'npx prisma migrate deploy');

// ── 2. Config import ──────────────────────────────────────────────────────────
run('config:import (sources + profiles)', 'npm run config:import --silent');

// ── 3. Backfill effectiveNewAt ────────────────────────────────────────────────
run('backfill effectiveNewAt', 'node scripts/backfill-effective-new-at.mjs');

// ── 4. Recover abandoned runs ─────────────────────────────────────────────────
run('recover abandoned runs (threshold 10m)', 'node scripts/recover-abandoned-runs.mjs -- --threshold-minutes 10');

// ── 5. Seed default user + migrate notification prefs ─────────────────────────
run('seed default user + notification prefs', 'node scripts/seed-default-user.mjs');

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════');
console.log('  Deploy bootstrap complete — DB snapshot');
console.log('═══════════════════════════════════════════════');

const [
  totalJobs,
  activeJobs,
  totalSources,
  enabledSources,
  totalProfiles,
  enabledProfiles,
  totalRecs,
  runningSyncRuns,
  runningRecRuns,
  defaultUser,
  unnotifiedRecs,
] = await Promise.all([
  prisma.job.count(),
  prisma.job.count({ where: { isActive: true } }),
  prisma.jobSource.count(),
  prisma.jobSource.count({ where: { enabled: true } }),
  prisma.roleProfile.count(),
  prisma.roleProfile.count({ where: { enabled: true } }),
  prisma.jobRecommendation.count(),
  prisma.syncRun.count({ where: { status: 'RUNNING' } }),
  prisma.recommendationRun.count({ where: { status: 'RUNNING' } }),
  prisma.user.findFirst({ where: { isDefault: true }, select: { id: true, name: true } }),
  prisma.jobRecommendation.count({ where: { notifiedAt: null, status: 'UNSEEN' } }),
]);

const nullEffective = await prisma.job.count({ where: { effectiveNewAt: null } });

console.log(`  Jobs              : ${activeJobs} active / ${totalJobs} total`);
console.log(`  Null effectiveNewAt: ${nullEffective}`);
console.log(`  JobSources        : ${enabledSources} enabled / ${totalSources} total`);
console.log(`  RoleProfiles      : ${enabledProfiles} enabled / ${totalProfiles} total`);
console.log(`  Recommendations   : ${totalRecs} total (${unnotifiedRecs} unnotified)`);
console.log(`  Default User      : ${defaultUser ? `${defaultUser.name} (${defaultUser.id})` : 'none'}`);
console.log(`  RUNNING SyncRuns  : ${runningSyncRuns}`);
console.log(`  RUNNING RecRuns   : ${runningRecRuns}`);
console.log('═══════════════════════════════════════════════\n');

await prisma.$disconnect();
