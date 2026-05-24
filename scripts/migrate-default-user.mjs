#!/usr/bin/env node
/**
 * npm run users:migrate-default
 *
 * Migrates all existing global data to the default user's per-user tables.
 * Safe to run multiple times (idempotent).
 *
 * Steps:
 *  1. Ensure default user exists
 *  2. Migrate RoleProfile → UserRoleProfile (for default user)
 *  3. Migrate JobRecommendation → UserJobRecommendation (via RoleProfile→UserRoleProfile map)
 *  4. Migrate Job.status != "NEW" → UserJobStatus
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Default User Migration");
  console.log("═══════════════════════════════════════════════\n");

  // ── 1. Ensure default user exists ────────────────────────────────────────
  let user = await prisma.user.findFirst({ where: { isDefault: true } });
  if (!user) {
    user = await prisma.user.create({
      data: { name: "Default User", isDefault: true },
    });
    console.log(`[1] Created default user id=${user.id}`);
  } else {
    console.log(`[1] Default user exists: ${user.name} (${user.id})`);
  }
  const userId = user.id;

  // ── 2. Migrate RoleProfile → UserRoleProfile ──────────────────────────────
  const globalProfiles = await prisma.roleProfile.findMany();
  console.log(`\n[2] Found ${globalProfiles.length} global RoleProfiles to migrate`);

  const profileIdMap = new Map(); // globalProfileId → userRoleProfileId

  for (const gp of globalProfiles) {
    const existing = await prisma.userRoleProfile.findUnique({
      where: { userId_name: { userId, name: gp.name } },
    });
    if (existing) {
      console.log(`    skip (exists): ${gp.name}`);
      profileIdMap.set(gp.id, existing.id);
      continue;
    }
    const created = await prisma.userRoleProfile.create({
      data: {
        userId,
        name:               gp.name,
        enabled:            gp.enabled,
        priority:           gp.priority,
        preferredTitles:    gp.preferredTitles,
        preferredLocations: gp.preferredLocations,
        mustHaveKeywords:   gp.mustHaveKeywords,
        niceHaveKeywords:   gp.niceHaveKeywords,
        negativeKeywords:   gp.negativeKeywords,
        requiresSponsorship: gp.requiresSponsorship,
        minScore:           gp.minScore,
      },
    });
    profileIdMap.set(gp.id, created.id);
    console.log(`    migrated: ${gp.name} → ${created.id}`);
  }
  console.log(`    profile map size: ${profileIdMap.size}`);

  // ── 3. Migrate JobRecommendation → UserJobRecommendation ─────────────────
  const globalRecs = await prisma.jobRecommendation.findMany({
    orderBy: { recommendedAt: "asc" },
  });
  console.log(`\n[3] Found ${globalRecs.length} global JobRecommendations to migrate`);

  let recCreated = 0;
  let recSkipped = 0;
  let recNoProfile = 0;

  for (const gr of globalRecs) {
    const urpId = profileIdMap.get(gr.roleProfileId);
    if (!urpId) {
      recNoProfile++;
      continue;
    }

    // Check if already migrated
    const existing = await prisma.userJobRecommendation.findUnique({
      where: { userId_jobId_userRoleProfileId: { userId, jobId: gr.jobId, userRoleProfileId: urpId } },
    });
    if (existing) {
      recSkipped++;
      continue;
    }

    try {
      await prisma.userJobRecommendation.create({
        data: {
          userId,
          jobId:             gr.jobId,
          userRoleProfileId: urpId,
          score:             gr.score,
          reason:            gr.reason,
          matched:           gr.matched,
          negatives:         gr.negatives,
          status:            gr.status,
          recommendedAt:     gr.recommendedAt,
          notifiedAt:        gr.notifiedAt,
          notificationDeliveryId: gr.notificationDeliveryId,
        },
      });
      recCreated++;
    } catch (err) {
      // Might fail if job was deleted — skip
      console.warn(`    skip rec jobId=${gr.jobId}: ${err.message?.slice(0, 80)}`);
    }
  }
  console.log(`    created=${recCreated}  skipped=${recSkipped}  no-profile=${recNoProfile}`);

  // ── 4. Migrate Job.status → UserJobStatus (non-NEW statuses only) ─────────
  const nonNewJobs = await prisma.job.findMany({
    where: { status: { notIn: ["NEW"] } },
    select: { id: true, status: true },
  });
  console.log(`\n[4] Found ${nonNewJobs.length} jobs with non-NEW status to migrate`);

  let statusCreated = 0;
  let statusSkipped = 0;

  for (const j of nonNewJobs) {
    const existing = await prisma.userJobStatus.findUnique({
      where: { userId_jobId: { userId, jobId: j.id } },
    });
    if (existing) { statusSkipped++; continue; }

    await prisma.userJobStatus.create({
      data: {
        userId,
        jobId:  j.id,
        status: j.status,
        appliedAt: j.status === "APPLIED" ? new Date() : null,
      },
    });
    statusCreated++;
  }
  console.log(`    created=${statusCreated}  skipped=${statusSkipped}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const [urpCount, ujrCount, ujsCount] = await Promise.all([
    prisma.userRoleProfile.count({ where: { userId } }),
    prisma.userJobRecommendation.count({ where: { userId } }),
    prisma.userJobStatus.count({ where: { userId } }),
  ]);

  console.log("\n═══════════════════════════════════════════════");
  console.log(`  User: ${user.name} (${userId})`);
  console.log(`  UserRoleProfiles:      ${urpCount}`);
  console.log(`  UserJobRecommendations: ${ujrCount}`);
  console.log(`  UserJobStatuses:        ${ujsCount}`);
  console.log("═══════════════════════════════════════════════\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
