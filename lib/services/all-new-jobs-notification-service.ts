/**
 * All-New-Jobs Notification Service
 *
 * Sends a digest of every newly-scraped job (ALL_NEW_JOBS type) — independent
 * of recommendations.  Keyed on Job.allNewJobsNotifiedAt for dedup.
 *
 * Env-var config (fallback when no DB pref exists):
 *   ALL_NEW_JOBS_NOTIFICATIONS_ENABLED=true
 *   ALL_NEW_JOBS_LOOKBACK_HOURS=1
 *   ALL_NEW_JOBS_MAX_JOBS=50
 *   ALL_NEW_JOBS_MAX_COMPANIES=10
 *   NOTIFICATION_CHANNEL=slack        (shared with rec-notifications)
 *   SLACK_WEBHOOK_URL / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / DISCORD_WEBHOOK_URL
 *   APP_PUBLIC_URL=http://localhost:3000
 */

import { prisma } from "@/lib/prisma";

export type AllNewJobsOptions = {
  /** Override lookback window (hours). Defaults to env ALL_NEW_JOBS_LOOKBACK_HOURS or 1. */
  lookbackHours?: number;
};

// ── Config ────────────────────────────────────────────────────────────────────

type ResolvedConfig = {
  enabled: boolean;
  channel: string;
  slackWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  lookbackHours: number;
  maxJobs: number;
  maxCompanies: number;
};

async function resolveConfig(lookbackOverride?: number): Promise<ResolvedConfig> {
  const envEnabled   = process.env.ALL_NEW_JOBS_NOTIFICATIONS_ENABLED === "true";
  const envLookback  = Number(process.env.ALL_NEW_JOBS_LOOKBACK_HOURS ?? "1") || 1;
  const envMaxJobs   = Number(process.env.ALL_NEW_JOBS_MAX_JOBS ?? "50") || 50;
  const envMaxCo     = Number(process.env.ALL_NEW_JOBS_MAX_COMPANIES ?? "10") || 10;
  const envChannel   = (process.env.NOTIFICATION_CHANNEL ?? "slack").toLowerCase();

  // Try to read from default user's DB pref
  try {
    const defaultUser = await prisma.user.findFirst({ where: { isDefault: true } });
    if (defaultUser) {
      const pref = await prisma.userNotificationPreference.findFirst({
        where: { userId: defaultUser.id, channel: envChannel.toUpperCase(), enabled: true },
      });
      if (pref) {
        return {
          enabled:           pref.allNewJobsEnabled,
          channel:           pref.channel.toLowerCase(),
          slackWebhookUrl:   pref.slackWebhookUrl   ?? process.env.SLACK_WEBHOOK_URL,
          telegramBotToken:  pref.telegramBotToken  ?? process.env.TELEGRAM_BOT_TOKEN,
          telegramChatId:    pref.telegramChatId    ?? process.env.TELEGRAM_CHAT_ID,
          discordWebhookUrl: pref.discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL,
          lookbackHours:     lookbackOverride ?? pref.allNewJobsLookbackHours,
          maxJobs:           pref.allNewJobsMaxJobs,
          maxCompanies:      pref.allNewJobsMaxCompanies,
        };
      }
    }
  } catch {
    // DB not ready — fall through to env
  }

  return {
    enabled:           envEnabled,
    channel:           envChannel,
    slackWebhookUrl:   process.env.SLACK_WEBHOOK_URL,
    telegramBotToken:  process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:    process.env.TELEGRAM_CHAT_ID,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    lookbackHours:     lookbackOverride ?? envLookback,
    maxJobs:           envMaxJobs,
    maxCompanies:      envMaxCo,
  };
}

// ── Message builders ──────────────────────────────────────────────────────────

type CompanyCount = { company: string; count: number };
type SampleJob    = { company: string; title: string; location: string | null };

function buildSlackMessage(
  totalJobs: number,
  lookbackHours: number,
  topCompanies: CompanyCount[],
  samples: SampleJob[],
  appUrl: string,
): string {
  const label = lookbackHours === 1 ? "last 1h" : `last ${lookbackHours}h`;
  const lines: string[] = [
    `🆕 *JobRadar: ${totalJobs} new job${totalJobs === 1 ? "" : "s"} scraped in ${label}*`,
    "",
  ];

  if (topCompanies.length > 0) {
    lines.push("*Top companies:*");
    for (const { company, count } of topCompanies) {
      lines.push(`• ${company} — ${count} job${count === 1 ? "" : "s"}`);
    }
    lines.push("");
  }

  if (samples.length > 0) {
    lines.push("*Sample new jobs:*");
    for (let i = 0; i < samples.length; i++) {
      const { company, title, location } = samples[i];
      const loc = location ? ` — ${location}` : "";
      lines.push(`${i + 1}. ${company} — ${title}${loc}`);
    }
    lines.push("");
  }

  lines.push(`Open all new jobs: ${appUrl}?view=jobs&newWindow=${lookbackHours}h`);
  return lines.join("\n");
}

function buildTelegramMessage(
  totalJobs: number,
  lookbackHours: number,
  topCompanies: CompanyCount[],
  samples: SampleJob[],
  appUrl: string,
): string {
  const label = lookbackHours === 1 ? "last 1h" : `last ${lookbackHours}h`;
  const lines: string[] = [
    `🆕 <b>JobRadar: ${totalJobs} new job${totalJobs === 1 ? "" : "s"} scraped in ${label}</b>`,
    "",
  ];

  if (topCompanies.length > 0) {
    lines.push("<b>Top companies:</b>");
    for (const { company, count } of topCompanies) {
      lines.push(`• ${company} — ${count} job${count === 1 ? "" : "s"}`);
    }
    lines.push("");
  }

  if (samples.length > 0) {
    lines.push("<b>Sample new jobs:</b>");
    for (let i = 0; i < samples.length; i++) {
      const { company, title, location } = samples[i];
      const loc = location ? ` — ${location}` : "";
      lines.push(`${i + 1}. ${company} — ${title}${loc}`);
    }
    lines.push("");
  }

  lines.push(`Open all new jobs: ${appUrl}?view=jobs&newWindow=${lookbackHours}h`);
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

export async function sendAllNewJobsNotification(
  opts: AllNewJobsOptions = {},
): Promise<void> {
  const cfg     = await resolveConfig(opts.lookbackHours);
  const appUrl  = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";
  const lookback = new Date(Date.now() - cfg.lookbackHours * 3_600_000);

  // ── SKIP check ────────────────────────────────────────────────────────────
  if (!cfg.enabled) {
    await prisma.notificationDelivery.create({
      data: {
        channel: cfg.channel.toUpperCase(),
        notificationType: "ALL_NEW_JOBS",
        status: "SKIPPED",
        windowHours: cfg.lookbackHours,
        messagePreview: "All-new-jobs notifications disabled",
      },
    });
    return;
  }

  // ── Query unnotified new jobs in window ───────────────────────────────────
  const rawJobs = await prisma.job.findMany({
    where: {
      isActive: true,
      allNewJobsNotifiedAt: null,
      firstSeenAt: { gte: lookback },
    },
    select: {
      id: true,
      jobFingerprint: true,
      company: true,
      title: true,
      location: true,
      firstSeenAt: true,
    },
    orderBy: [{ firstSeenAt: "desc" }, { company: "asc" }],
  });

  // ── Dedupe by fingerprint ─────────────────────────────────────────────────
  const seenFingerprints = new Set<string>();
  const uniqueJobs: typeof rawJobs = [];
  for (const job of rawJobs) {
    const key = job.jobFingerprint ?? job.id;
    if (!seenFingerprints.has(key)) {
      seenFingerprints.add(key);
      uniqueJobs.push(job);
    }
  }

  if (uniqueJobs.length === 0) {
    await prisma.notificationDelivery.create({
      data: {
        channel: cfg.channel.toUpperCase(),
        notificationType: "ALL_NEW_JOBS",
        status: "SKIPPED",
        windowHours: cfg.lookbackHours,
        messagePreview: "No new unnotified jobs",
      },
    });
    return;
  }

  // ── Compute top companies ─────────────────────────────────────────────────
  const companyMap = new Map<string, number>();
  for (const job of uniqueJobs) {
    companyMap.set(job.company, (companyMap.get(job.company) ?? 0) + 1);
  }
  const topCompanies: CompanyCount[] = [...companyMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.maxCompanies)
    .map(([company, count]) => ({ company, count }));

  // ── Sample jobs (up to maxJobs) ───────────────────────────────────────────
  const samples: SampleJob[] = uniqueJobs.slice(0, cfg.maxJobs).map((j) => ({
    company: j.company,
    title: j.title,
    location: j.location,
  }));

  const totalJobs = uniqueJobs.length;

  // ── Build message ─────────────────────────────────────────────────────────
  let message: string;
  if (cfg.channel === "telegram") {
    message = buildTelegramMessage(totalJobs, cfg.lookbackHours, topCompanies, samples, appUrl);
  } else {
    message = buildSlackMessage(totalJobs, cfg.lookbackHours, topCompanies, samples, appUrl);
  }
  const preview = message.split("\n")[0].slice(0, 200);

  // All raw job IDs to mark (pre-dedup set — mark originals only)
  const rawJobIds = rawJobs.map((j) => j.id);

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

    // Mark all queried job rows as notified (even dupes — so they don't resurface)
    const now = new Date();
    await prisma.notificationDelivery.create({
      data: {
        channel:          cfg.channel.toUpperCase(),
        notificationType: "ALL_NEW_JOBS",
        status:           "SENT",
        windowHours:      cfg.lookbackHours,
        jobCount:         totalJobs,
        messagePreview:   preview,
        sentAt:           now,
      },
    });

    await prisma.job.updateMany({
      where: { id: { in: rawJobIds } },
      data:  { allNewJobsNotifiedAt: now },
    });

    console.log(
      `[all-new-jobs] SENT via ${cfg.channel.toUpperCase()} — ${totalJobs} unique jobs lookback=${cfg.lookbackHours}h`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[all-new-jobs] Send failed (${cfg.channel}):`, errorMessage);

    await prisma.notificationDelivery.create({
      data: {
        channel:          cfg.channel.toUpperCase(),
        notificationType: "ALL_NEW_JOBS",
        status:           "FAILED",
        windowHours:      cfg.lookbackHours,
        jobCount:         totalJobs,
        messagePreview:   preview,
        errorMessage:     errorMessage.slice(0, 1000),
      },
    });
  }
}
