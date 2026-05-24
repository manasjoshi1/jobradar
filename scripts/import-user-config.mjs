#!/usr/bin/env node
/**
 * npm run users:import-config -- --file ./config/users/default-user.yml
 *
 * Imports a user config YAML into the database.
 * Safe to run multiple times (idempotent — upserts everything).
 *
 * What it does:
 *  1. Upsert User (by isDefault=true or email)
 *  2. Upsert UserJobPreference
 *  3. Upsert each UserRoleProfile by (userId, name)
 *  4. Does NOT delete existing recommendations or history
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  if (fileIdx === -1 || !args[fileIdx + 1]) {
    console.error("Usage: node scripts/import-user-config.mjs --file <path>");
    process.exit(1);
  }
  return { file: resolve(args[fileIdx + 1]) };
}

async function main() {
  const { file } = parseArgs();
  console.log(`\n[import-user-config] Loading: ${file}\n`);

  const raw  = readFileSync(file, "utf8");
  const cfg  = yaml.load(raw);

  // ── 1. Upsert User ───────────────────────────────────────────────────────
  const userCfg = cfg.user ?? {};
  let user;

  if (userCfg.isDefault) {
    user = await prisma.user.findFirst({ where: { isDefault: true } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name:      userCfg.name ?? "Default User",
          email:     userCfg.email || null,
          isDefault: true,
        },
      });
      console.log(`[1] Created default user: ${user.name} (${user.id})`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data:  { name: userCfg.name ?? user.name },
      });
      console.log(`[1] Existing default user: ${user.name} (${user.id})`);
    }
  } else if (userCfg.email) {
    user = await prisma.user.upsert({
      where:  { email: userCfg.email },
      update: { name: userCfg.name ?? undefined },
      create: { name: userCfg.name, email: userCfg.email, isDefault: false },
    });
    console.log(`[1] Upserted user by email: ${user.email} (${user.id})`);
  } else {
    throw new Error("Config must have user.isDefault=true or user.email");
  }

  const userId = user.id;

  // ── 2. Upsert UserJobPreference ───────────────────────────────────────────
  const pref = cfg.preferences ?? {};
  const prefData = {
    targetLocations:    pref.targetLocations    ? JSON.stringify(pref.targetLocations)    : null,
    targetRoles:        pref.targetRoles        ? JSON.stringify(pref.targetRoles)        : null,
    blockedCompanies:   pref.blockedCompanies   ? JSON.stringify(pref.blockedCompanies)   : null,
    preferredCompanies: pref.preferredCompanies ? JSON.stringify(pref.preferredCompanies) : null,
    minScore:           pref.minScore           ?? 45,
    requiresSponsorship: pref.requiresSponsorship ?? false,
  };

  await prisma.userJobPreference.upsert({
    where:  { userId },
    update: prefData,
    create: { userId, ...prefData },
  });
  console.log(`[2] UserJobPreference upserted`);

  // ── 3. Upsert UserRoleProfiles ────────────────────────────────────────────
  const profiles = cfg.roleProfiles ?? [];
  console.log(`[3] Upserting ${profiles.length} role profiles…`);

  for (const p of profiles) {
    const profileData = {
      enabled:            p.enabled  ?? true,
      priority:           p.priority ?? 0,
      minScore:           p.minScore ?? 50,
      requiresSponsorship: p.requiresSponsorship ?? false,
      preferredTitles:    JSON.stringify(p.preferredTitles    ?? []),
      preferredLocations: JSON.stringify(p.preferredLocations ?? []),
      mustHaveKeywords:   JSON.stringify(p.mustHaveKeywords   ?? []),
      niceHaveKeywords:   JSON.stringify(p.niceHaveKeywords   ?? []),
      negativeKeywords:   JSON.stringify(p.negativeKeywords   ?? []),
    };

    await prisma.userRoleProfile.upsert({
      where:  { userId_name: { userId, name: p.name } },
      update: profileData,
      create: { userId, name: p.name, ...profileData },
    });
    console.log(`    ✓ ${p.name}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const [urpCount, hasPrefs] = await Promise.all([
    prisma.userRoleProfile.count({ where: { userId } }),
    prisma.userJobPreference.findUnique({ where: { userId } }),
  ]);

  console.log(`\n[import-user-config] Done`);
  console.log(`  User: ${user.name} (${userId})`);
  console.log(`  UserRoleProfiles: ${urpCount}`);
  console.log(`  Preferences: ${hasPrefs ? "set" : "none"}`);
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
