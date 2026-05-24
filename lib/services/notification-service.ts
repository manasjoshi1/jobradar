/**
 * Notification service — sends recommendation alerts via Telegram, Discord, or Slack.
 *
 * Key behaviour:
 *  - Queries its own unnotified (notifiedAt IS NULL) recommendations
 *  - Groups by unique jobId so same job shown across N profiles appears once
 *  - Company diversity: max maxJobsPerCompany (default 2) per company
 *  - After successful send: marks all included recs with notifiedAt
 *  - Reads per-user config from DB (UserNotificationPreference) then falls
 *    back to env vars for the Default User / single-tenant mode
 *
 * Env vars (fallback when no DB preference exists):
 *   NOTIFICATIONS_ENABLED=true
 *   NOTIFICATION_CHANNEL=slack          (slack | telegram | discord)
 *   SLACK_WEBHOOK_URL=...
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=...
 *   DISCORD_WEBHOOK_URL=...
 *   APP_PUBLIC_URL=http://localhost:3000
 *   NOTIFICATION_LOOKBACK_HOURS=24
 *   NOTIFICATION_MAX_JOBS=10
 *   NOTIFICATION_MAX_JOBS_PER_COMPANY=2
 */

import { prisma } from "@/lib/prisma";
import { groupRecommendations } from "@/lib/recommendation/group-recommendations";
import type { GroupedJobRecommendation } from "@/lib/recommendation/group-recommendations";

export type NotifyOptions = {
  recommendationRunId?: string;
  /** Override lookback window (hours). Defaults to env NOTIFICATION_LOOKBACK_HOURS or 24. */
  lookbackHours?: number;
};

// ── Channel config resolved from DB pref + env fallback ──────────────────────

type ResolvedConfig = {
  enabled: boolean;
  channel: string;
  slackWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  lookbackHours: number;
  maxJobs: number;
  maxJobsPerCompany: number;
};

async function resolveConfig(lookbackOverride?: number): Promise<ResolvedConfig> {
  const envChannel  = (process.env.NOTIFICATION_CHANNEL ?? "slack").toLowerCase();
  const envEnabled  = process.env.NOTIFICATIONS_ENABLED === "true";
  const envLookback = Number(process.env.NOTIFICATION_LOOKBACK_HOURS ?? "24") || 24;
  const envMaxJobs  = Number(process.env.NOTIFICATION_MAX_JOBS ?? "10") || 10;
  const envMaxPerCo = Number(process.env.NOTIFICATION_MAX_JOBS_PER_COMPANY ?? "2") || 2;

  // Try to read from Default User's DB preference
  try {
    const defaultUser = await prisma.user.findFirst({ where: { isDefault: true } });
    if (defaultUser) {
      const pref = await prisma.userNotificationPreference.findFirst({
        where: { userId: defaultUser.id, channel: envChannel.toUpperCase(), enabled: true },
      });
      if (pref) {
        return {
          enabled:          true,
          channel:          pref.channel.toLowerCase(),
          slackWebhookUrl:  pref.slackWebhookUrl   ?? process.env.SLACK_WEBHOOK_URL,
          telegramBotToken: pref.telegramBotToken  ?? process.env.TELEGRAM_BOT_TOKEN,
          telegramChatId:   pref.telegramChatId    ?? process.env.TELEGRAM_CHAT_ID,
          discordWebhookUrl: pref.discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL,
          lookbackHours:    lookbackOverride ?? pref.lookbackHours,
          maxJobs:          pref.maxJobs,
          maxJobsPerCompany: pref.maxJobsPerCompany,
        };
      }
    }
  } catch {
    // DB not ready or no user — fall through to env
  }

  return {
    enabled:          envEnabled,
    channel:          envChannel,
    slackWebhookUrl:  process.env.SLACK_WEBHOOK_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:   process.env.TELEGRAM_CHAT_ID,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    lookbackHours:    lookbackOverride ?? envLookback,
    maxJobs:          envMaxJobs,
    maxJobsPerCompany: envMaxPerCo,
  };
}

// ── Message builders ──────────────────────────────────────────────────────────

function timeAgoStr(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const ms  = Date.now() - new Date(iso).getTime();
  const m   = Math.floor(ms / 60000);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function buildSlackMessage(jobs: GroupedJobRecommendation[], appUrl: string): string {
  const count = jobs.length;
  const lines: string[] = [
    `🔔 *JobRadar: ${count} new relevant job${count === 1 ? "" : "s"}*`,
    "",
  ];

  for (let i = 0; i < jobs.length; i++) {
    const g = jobs[i];
    const otherProfiles = g.matchedProfiles
      .filter((p) => p.roleProfileId !== g.bestRoleProfile.id)
      .slice(0, 3)
      .map((p) => p.name);

    lines.push(`${i + 1}. *${g.job.company} — ${g.job.title}* — Score: ${g.bestScore}`);
    lines.push(`   Best match: ${g.bestRoleProfile.name}`);
    if (otherProfiles.length > 0) {
      lines.push(`   Also matched: ${otherProfiles.join(", ")}`);
    }
    const ref = g.job.effectiveNewAt ?? g.job.postedAt ?? g.job.firstSeenAt;
    lines.push(`   Posted: ${timeAgoStr(ref)}`);
    lines.push(`   Apply: ${g.job.applyUrl}`);
    if (i < jobs.length - 1) lines.push("");
  }

  lines.push("", `Open JobRadar: ${appUrl}`);
  return lines.join("\n");
}

function buildTelegramMessage(jobs: GroupedJobRecommendation[], appUrl: string): string {
  const count = jobs.length;
  const lines: string[] = [
    `🔔 <b>JobRadar: ${count} new relevant job${count === 1 ? "" : "s"}</b>`,
    "",
  ];

  for (let i = 0; i < jobs.length; i++) {
    const g = jobs[i];
    const otherProfiles = g.matchedProfiles
      .filter((p) => p.roleProfileId !== g.bestRoleProfile.id)
      .slice(0, 3)
      .map((p) => p.name);

    lines.push(`${i + 1}. <b>${g.job.company} — ${g.job.title}</b> — ${g.bestScore}`);
    lines.push(`   Best: ${g.bestRoleProfile.name}`);
    if (otherProfiles.length > 0) {
      lines.push(`   Also: ${otherProfiles.join(", ")}`);
    }
    const ref = g.job.effectiveNewAt ?? g.job.postedAt ?? g.job.firstSeenAt;
    lines.push(`   Posted: ${timeAgoStr(ref)}`);
    lines.push(`   <a href="${g.job.applyUrl}">Apply →</a>`);
    if (i < jobs.length - 1) lines.push("");
  }

  lines.push("", `Open JobRadar: ${appUrl}`);
  return lines.join("\n");
}

// ── Channel senders ───────────────────────────────────────────────────────────

async function sendSlack(message: string, webhookUrl: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook error ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendTelegram(message: string, token: string, chatId: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendDiscord(message: string, webhookUrl: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook error ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendRecommendationNotification(
  opts: NotifyOptions = {},
): Promise<void> {
  const cfg     = await resolveConfig(opts.lookbackHours);
  const appUrl  = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";
  const lookback = new Date(Date.now() - cfg.lookbackHours * 3600_000);

  if (!cfg.enabled) {
    await prisma.notificationDelivery.create({
      data: {
        channel: "NONE", status: "SKIPPED",
        windowHours: cfg.lookbackHours, recommendationCount: 0,
        messagePreview: "Notifications disabled",
        recommendationRunId: opts.recommendationRunId ?? null,
      },
    });
    return;
  }

  // ── Fetch all unnotified UNSEEN recommendations within lookback window ──────
  const rawRecs = await prisma.jobRecommendation.findMany({
    where: {
      notifiedAt:    null,
      status:        "UNSEEN",
      recommendedAt: { gte: lookback },
      job:           { isActive: true },
    },
    orderBy: { score: "desc" },
    select: {
      id: true, score: true, reason: true, matched: true, negatives: true,
      status: true, recommendedAt: true,
      roleProfile: { select: { id: true, name: true, priority: true, minScore: true } },
      job: {
        select: {
          id: true, title: true, company: true, location: true,
          department: true, employmentType: true, applyUrl: true,
          postedAt: true, firstSeenAt: true, effectiveNewAt: true,
          status: true, sponsorship: true, isActive: true,
        },
      },
    },
  });

  // ── Group by unique jobId ──────────────────────────────────────────────────
  const grouped = groupRecommendations(rawRecs);

  if (grouped.length === 0) {
    await prisma.notificationDelivery.create({
      data: {
        channel: cfg.channel.toUpperCase(), status: "SKIPPED",
        windowHours: cfg.lookbackHours, recommendationCount: 0,
        messagePreview: "No unnotified recommendations",
        recommendationRunId: opts.recommendationRunId ?? null,
      },
    });
    return;
  }

  // ── Company diversity filter ────────────────────────────────────────────────
  const selected: GroupedJobRecommendation[] = [];
  const companyCount = new Map<string, number>();

  for (const g of grouped) {
    if (selected.length >= cfg.maxJobs) break;
    const co = g.job.company.toLowerCase();
    const coCount = companyCount.get(co) ?? 0;
    if (coCount >= cfg.maxJobsPerCompany) continue;
    selected.push(g);
    companyCount.set(co, coCount + 1);
  }

  // Collect all recommendation IDs from selected groups
  const recIds = selected.flatMap((g) => g.matchedProfiles.map((p) => p.recommendationId));
  const uniqueJobCount = selected.length;

  // ── Build message ──────────────────────────────────────────────────────────
  let message: string;
  if (cfg.channel === "telegram") {
    message = buildTelegramMessage(selected, appUrl);
  } else {
    message = buildSlackMessage(selected, appUrl);
  }
  const preview = message.split("\n")[0].slice(0, 200);

  // ── Send ──────────────────────────────────────────────────────────────────
  try {
    if (cfg.channel === "slack" && cfg.slackWebhookUrl) {
      await sendSlack(message, cfg.slackWebhookUrl);
    } else if (cfg.channel === "telegram" && cfg.telegramBotToken && cfg.telegramChatId) {
      await sendTelegram(message, cfg.telegramBotToken, cfg.telegramChatId);
    } else if (cfg.channel === "discord" && cfg.discordWebhookUrl) {
      await sendDiscord(message, cfg.discordWebhookUrl);
    } else {
      throw new Error(`Channel "${cfg.channel}" not configured (missing credentials)`);
    }

    // Mark all included recs as notified
    const delivery = await prisma.notificationDelivery.create({
      data: {
        channel:             cfg.channel.toUpperCase(),
        status:              "SENT",
        windowHours:         cfg.lookbackHours,
        recommendationCount: uniqueJobCount,
        messagePreview:      preview,
        sentAt:              new Date(),
        recommendationRunId: opts.recommendationRunId ?? null,
      },
    });

    await prisma.jobRecommendation.updateMany({
      where: { id: { in: recIds } },
      data: {
        notifiedAt:             new Date(),
        notificationDeliveryId: delivery.id,
      },
    });

    console.log(
      `[notifications] SENT via ${cfg.channel.toUpperCase()} — ${uniqueJobCount} unique jobs (${recIds.length} recs) lookback=${cfg.lookbackHours}h`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[notifications] Send failed (${cfg.channel}):`, errorMessage);

    await prisma.notificationDelivery.create({
      data: {
        channel:             cfg.channel.toUpperCase(),
        status:              "FAILED",
        windowHours:         cfg.lookbackHours,
        recommendationCount: uniqueJobCount,
        messagePreview:      preview,
        errorMessage:        errorMessage.slice(0, 1000),
        recommendationRunId: opts.recommendationRunId ?? null,
      },
    });
  }
}
