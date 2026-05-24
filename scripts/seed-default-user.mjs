#!/usr/bin/env node
/**
 * Creates the default user and migrates env-based notification config into
 * UserNotificationPreference rows.  Safe to run multiple times (idempotent).
 *
 * Usage:
 *   node scripts/seed-default-user.mjs
 *   OR via npm: npm run db:seed-user
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Ensure default user exists
  let user = await prisma.user.findFirst({ where: { isDefault: true } });
  if (!user) {
    user = await prisma.user.create({
      data: { name: "Default User", isDefault: true },
    });
    console.log(`[seed-user] Created default user id=${user.id}`);
  } else {
    console.log(`[seed-user] Default user exists id=${user.id}`);
  }

  // 2. Migrate SLACK env config if present
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    await prisma.userNotificationPreference.upsert({
      where:  { userId_channel: { userId: user.id, channel: "SLACK" } },
      update: { slackWebhookUrl: slackUrl, enabled: process.env.NOTIFICATION_CHANNEL?.toUpperCase() === "SLACK" && process.env.NOTIFICATIONS_ENABLED === "true" },
      create: {
        userId: user.id, channel: "SLACK",
        slackWebhookUrl: slackUrl,
        enabled: process.env.NOTIFICATION_CHANNEL?.toUpperCase() === "SLACK" && process.env.NOTIFICATIONS_ENABLED === "true",
        lookbackHours:    Number(process.env.NOTIFICATION_LOOKBACK_HOURS ?? "24") || 24,
        maxJobs:          Number(process.env.NOTIFICATION_MAX_JOBS ?? "10") || 10,
        maxJobsPerCompany: Number(process.env.NOTIFICATION_MAX_JOBS_PER_COMPANY ?? "2") || 2,
      },
    });
    console.log(`[seed-user] SLACK preference seeded/updated`);
  }

  // 3. Migrate TELEGRAM env config if present
  const tgToken  = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChatId) {
    await prisma.userNotificationPreference.upsert({
      where:  { userId_channel: { userId: user.id, channel: "TELEGRAM" } },
      update: { telegramBotToken: tgToken, telegramChatId: tgChatId, enabled: process.env.NOTIFICATION_CHANNEL?.toUpperCase() === "TELEGRAM" && process.env.NOTIFICATIONS_ENABLED === "true" },
      create: {
        userId: user.id, channel: "TELEGRAM",
        telegramBotToken: tgToken, telegramChatId: tgChatId,
        enabled: process.env.NOTIFICATION_CHANNEL?.toUpperCase() === "TELEGRAM" && process.env.NOTIFICATIONS_ENABLED === "true",
        lookbackHours:    Number(process.env.NOTIFICATION_LOOKBACK_HOURS ?? "24") || 24,
        maxJobs:          Number(process.env.NOTIFICATION_MAX_JOBS ?? "10") || 10,
        maxJobsPerCompany: Number(process.env.NOTIFICATION_MAX_JOBS_PER_COMPANY ?? "2") || 2,
      },
    });
    console.log(`[seed-user] TELEGRAM preference seeded/updated`);
  }

  // 4. Migrate DISCORD env config if present
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (discordUrl) {
    await prisma.userNotificationPreference.upsert({
      where:  { userId_channel: { userId: user.id, channel: "DISCORD" } },
      update: { discordWebhookUrl: discordUrl, enabled: process.env.NOTIFICATION_CHANNEL?.toUpperCase() === "DISCORD" && process.env.NOTIFICATIONS_ENABLED === "true" },
      create: {
        userId: user.id, channel: "DISCORD",
        discordWebhookUrl: discordUrl,
        enabled: process.env.NOTIFICATION_CHANNEL?.toUpperCase() === "DISCORD" && process.env.NOTIFICATIONS_ENABLED === "true",
        lookbackHours:    Number(process.env.NOTIFICATION_LOOKBACK_HOURS ?? "24") || 24,
        maxJobs:          Number(process.env.NOTIFICATION_MAX_JOBS ?? "10") || 10,
        maxJobsPerCompany: Number(process.env.NOTIFICATION_MAX_JOBS_PER_COMPANY ?? "2") || 2,
      },
    });
    console.log(`[seed-user] DISCORD preference seeded/updated`);
  }

  console.log("[seed-user] Done");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
