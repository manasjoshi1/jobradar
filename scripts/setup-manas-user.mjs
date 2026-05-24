#!/usr/bin/env node
/**
 * node scripts/setup-manas-user.mjs --file <path-to-yaml>
 *
 * Imports Manas's config into the existing default user slot:
 *   1. Updates default user: name=Manas, email=joshimanassunil@gmail.com
 *   2. Upserts UserJobPreference from YAML
 *   3. Upserts all UserRoleProfiles from YAML
 *   4. Carries over existing notification preferences (no change to those)
 *
 * This is idempotent — safe to re-run.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const yaml    = require("js-yaml");

const args    = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const file    = fileIdx >= 0 ? resolve(args[fileIdx + 1]) : null;

if (!file) {
  console.error("Usage: node scripts/setup-manas-user.mjs --file <path>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`\n[setup-manas] Loading: ${file}\n`);
  const raw = readFileSync(file, "utf8");
  const cfg = yaml.load(raw);

  // ── 1. Get / update default user ─────────────────────────────────────────
  let user = await prisma.user.findFirst({ where: { isDefault: true } });
  if (!user) {
    user = await prisma.user.create({
      data: { name: "Manas", email: "joshimanassunil@gmail.com", isDefault: true },
    });
    console.log(`[1] Created default user: Manas (${user.id})`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data:  { name: "Manas", email: "joshimanassunil@gmail.com" },
    });
    console.log(`[1] Updated default user → Manas <joshimanassunil@gmail.com> (${user.id})`);
  }
  const userId = user.id;

  // ── 2. Upsert UserJobPreference ───────────────────────────────────────────
  const pref = cfg.preferences ?? {};
  const prefData = {
    targetLocations:     pref.targetLocations    ? JSON.stringify(pref.targetLocations)    : null,
    targetRoles:         pref.targetRoles        ? JSON.stringify(pref.targetRoles)        : null,
    blockedCompanies:    pref.blockedCompanies   ? JSON.stringify(pref.blockedCompanies)   : null,
    preferredCompanies:  pref.preferredCompanies ? JSON.stringify(pref.preferredCompanies) : null,
    minScore:            pref.minScore           ?? 42,
    requiresSponsorship: pref.requiresSponsorship ?? true,
  };

  await prisma.userJobPreference.upsert({
    where:  { userId },
    update: prefData,
    create: { userId, ...prefData },
  });
  console.log(`[2] UserJobPreference upserted (${pref.targetLocations?.length ?? 0} locations, ` +
    `${pref.targetRoles?.length ?? 0} roles, minScore=${prefData.minScore}, sponsorship=${prefData.requiresSponsorship})`);

  // ── 3. Upsert UserRoleProfiles ────────────────────────────────────────────
  const profiles = cfg.roleProfiles ?? [];
  console.log(`[3] Upserting ${profiles.length} role profiles…`);

  for (const p of profiles) {
    const profileData = {
      enabled:             p.enabled             ?? true,
      priority:            p.priority            ?? 0,
      minScore:            p.minScore            ?? 42,
      requiresSponsorship: p.requiresSponsorship ?? true,
      preferredTitles:     JSON.stringify(p.preferredTitles    ?? []),
      preferredLocations:  JSON.stringify(p.preferredLocations ?? []),
      mustHaveKeywords:    JSON.stringify(p.mustHaveKeywords   ?? []),
      niceHaveKeywords:    JSON.stringify(p.niceHaveKeywords   ?? []),
      negativeKeywords:    JSON.stringify(p.negativeKeywords   ?? []),
    };

    await prisma.userRoleProfile.upsert({
      where:  { userId_name: { userId, name: p.name } },
      update: profileData,
      create: { userId, name: p.name, ...profileData },
    });
    console.log(`    ✓ [${p.priority}] ${p.name}`);
  }

  // ── 4. Notification preferences — carry over existing (don't wipe) ────────
  const notifPrefs = await prisma.userNotificationPreference.findMany({ where: { userId } });
  if (notifPrefs.length > 0) {
    console.log(`[4] Notification preferences kept (${notifPrefs.map(p => p.channel).join(", ")})`);
  } else {
    // Try to seed from env if nothing exists
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    const tgToken  = process.env.TELEGRAM_BOT_TOKEN;
    const tgChat   = process.env.TELEGRAM_CHAT_ID;
    const ch       = (process.env.NOTIFICATION_CHANNEL ?? "").toUpperCase();
    const enabled  = process.env.NOTIFICATIONS_ENABLED === "true";

    if (slackUrl) {
      await prisma.userNotificationPreference.upsert({
        where:  { userId_channel: { userId, channel: "SLACK" } },
        update: { slackWebhookUrl: slackUrl, enabled: enabled && ch === "SLACK" },
        create: { userId, channel: "SLACK", slackWebhookUrl: slackUrl,
                  enabled: enabled && ch === "SLACK",
                  lookbackHours: 24, maxJobs: 10, maxJobsPerCompany: 2 },
      });
      console.log(`[4] SLACK notification preference seeded from env`);
    }
    if (tgToken && tgChat) {
      await prisma.userNotificationPreference.upsert({
        where:  { userId_channel: { userId, channel: "TELEGRAM" } },
        update: { telegramBotToken: tgToken, telegramChatId: tgChat, enabled: enabled && ch === "TELEGRAM" },
        create: { userId, channel: "TELEGRAM", telegramBotToken: tgToken, telegramChatId: tgChat,
                  enabled: enabled && ch === "TELEGRAM",
                  lookbackHours: 24, maxJobs: 10, maxJobsPerCompany: 2 },
      });
      console.log(`[4] TELEGRAM notification preference seeded from env`);
    }
    if (!slackUrl && !tgToken) {
      console.log(`[4] No notification prefs found (set them via /api/settings/notifications)`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const [rpCount, recCount, statusCount] = await Promise.all([
    prisma.userRoleProfile.count({ where: { userId } }),
    prisma.userJobRecommendation.count({ where: { userId } }),
    prisma.userJobStatus.count({ where: { userId } }),
  ]);

  console.log(`\n${"═".repeat(55)}`);
  console.log(`  User:            Manas (${userId})`);
  console.log(`  Email:           joshimanassunil@gmail.com`);
  console.log(`  isDefault:       true`);
  console.log(`  Role profiles:   ${rpCount}`);
  console.log(`  Existing recs:   ${recCount}`);
  console.log(`  Job statuses:    ${statusCount}`);
  console.log(`${"═".repeat(55)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
