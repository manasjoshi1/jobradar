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
import fs from 'fs';
import path from 'path';
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

// ── 2. Config import (only if YAML files present on this server) ──────────────
const configImportNeeded = fs.existsSync(path.join(process.cwd(), 'config', 'job-sources.yml'));
if (configImportNeeded) {
  console.log('\n[2] Importing YAML config files...');
  run('config:import (sources + profiles)', 'npm run config:import --silent');
} else {
  console.log('\n[2] No config/job-sources.yml found — skipping YAML import (config is in DB)');
}

// ── 3. Backfill effectiveNewAt ────────────────────────────────────────────────
run('backfill effectiveNewAt', 'node scripts/backfill-effective-new-at.mjs');

// ── 4. Recover abandoned runs ─────────────────────────────────────────────────
run('recover abandoned runs (threshold 10m)', 'node scripts/recover-abandoned-runs.mjs -- --threshold-minutes 10');

// ── 5. Seed default user + migrate notification prefs ─────────────────────────
run('seed default user + notification prefs', 'node scripts/seed-default-user.mjs');

// ── 6. Import user config (role profiles + preferences) ──────────────────────
const userConfigPath = path.join(process.cwd(), 'config', 'users', 'default-user.yml');
if (fs.existsSync(userConfigPath)) {
  console.log('\n[6] Importing user config YAML...');
  run('import user config', `node scripts/import-user-config.mjs --file ${userConfigPath}`);
} else {
  console.log('\n[6] No user YAML found — skipping (config is in DB)');
}

// ── 7. Migrate existing global data to default user ──────────────────────────
run('migrate global data to default user', 'node scripts/migrate-default-user.mjs');

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════');
console.log('  Deploy bootstrap complete — DB snapshot');
console.log('═══════════════════════════════════════════════');

const defaultUser = await prisma.user.findFirst({ where: { isDefault: true }, select: { id: true, name: true } });

const [
  totalJobs, activeJobs, totalSources, enabledSources,
  totalProfiles, enabledProfiles,
  runningSyncRuns,
  // User-level counts
  userProfiles, userEnabledProfiles,
  userRecs, userUnnotifiedRecs,
  userStatuses,
] = await Promise.all([
  prisma.job.count(),
  prisma.job.count({ where: { isActive: true } }),
  prisma.jobSource.count(),
  prisma.jobSource.count({ where: { enabled: true } }),
  prisma.roleProfile.count(),
  prisma.roleProfile.count({ where: { enabled: true } }),
  prisma.syncRun.count({ where: { status: 'RUNNING' } }),
  defaultUser ? prisma.userRoleProfile.count({ where: { userId: defaultUser.id } }) : 0,
  defaultUser ? prisma.userRoleProfile.count({ where: { userId: defaultUser.id, enabled: true } }) : 0,
  defaultUser ? prisma.userJobRecommendation.count({ where: { userId: defaultUser.id } }) : 0,
  defaultUser ? prisma.userJobRecommendation.count({ where: { userId: defaultUser.id, notifiedAt: null, status: 'UNSEEN' } }) : 0,
  defaultUser ? prisma.userJobStatus.count({ where: { userId: defaultUser.id } }) : 0,
]);

const nullEffective = await prisma.job.count({ where: { effectiveNewAt: null } });

console.log(`  Jobs              : ${activeJobs} active / ${totalJobs} total`);
console.log(`  Null effectiveNewAt: ${nullEffective}`);
console.log(`  JobSources        : ${enabledSources} enabled / ${totalSources} total`);
console.log(`  Global RoleProfiles: ${enabledProfiles} enabled / ${totalProfiles} total`);
console.log(`  Default User      : ${defaultUser ? `${defaultUser.name} (${defaultUser.id})` : 'none'}`);
console.log(`  User RoleProfiles : ${userEnabledProfiles} enabled / ${userProfiles} total`);
console.log(`  User Recs         : ${userRecs} total (${userUnnotifiedRecs} unnotified)`);
console.log(`  User JobStatuses  : ${userStatuses}`);
console.log(`  RUNNING SyncRuns  : ${runningSyncRuns}`);
console.log('═══════════════════════════════════════════════\n');

await prisma.$disconnect();
