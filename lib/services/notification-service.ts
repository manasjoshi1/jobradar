/**
 * Notification service — sends recommendation alerts via Telegram, Discord, or Slack.
 *
 * Env vars:
 *   NOTIFICATIONS_ENABLED=true          (default false)
 *   NOTIFICATION_CHANNEL=telegram       (telegram | discord | slack)
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=...
 *   DISCORD_WEBHOOK_URL=...
 *   SLACK_WEBHOOK_URL=...
 *   APP_PUBLIC_URL=http://localhost:3000
 */

import { prisma } from "@/lib/prisma";

type NotifyInput = {
  windowHours: number;
  recommendationRunId?: string;
  newRecommendations: Array<{
    score: number;
    job: { company: string; title: string; applyUrl: string };
    roleProfile: { name: string };
  }>;
};

function buildMessage(input: NotifyInput): string {
  const { windowHours, newRecommendations } = input;
  const count = newRecommendations.length;
  const url = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";

  const top5 = [...newRecommendations]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const lines = [
    `🔔 <b>JobRadar:</b> ${count} new relevant job${count === 1 ? "" : "s"} in last ${windowHours}h`,
    "",
    "<b>Top matches:</b>",
    ...top5.map(
      (r, i) =>
        `${i + 1}. ${r.job.company} — ${r.job.title} — <b>${r.score}</b> (${r.roleProfile.name})`,
    ),
    "",
    `Open JobRadar: ${url}`,
  ];

  return lines.join("\n");
}

function buildPlainMessage(input: NotifyInput): string {
  const { windowHours, newRecommendations } = input;
  const count = newRecommendations.length;
  const url = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";

  const top5 = [...newRecommendations]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const lines = [
    `🔔 JobRadar: ${count} new relevant job${count === 1 ? "" : "s"} in last ${windowHours}h`,
    "",
    "Top matches:",
    ...top5.map(
      (r, i) =>
        `${i + 1}. ${r.job.company} — ${r.job.title} — ${r.score} (${r.roleProfile.name})`,
    ),
    "",
    `Open JobRadar: ${url}`,
  ];

  return lines.join("\n");
}

async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendDiscord(message: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error("DISCORD_WEBHOOK_URL is required");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook error ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendSlack(message: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL is required");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook error ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function sendRecommendationNotification(
  input: NotifyInput,
): Promise<void> {
  const enabled = process.env.NOTIFICATIONS_ENABLED === "true";
  const channel = (process.env.NOTIFICATION_CHANNEL ?? "telegram").toLowerCase();
  const { windowHours, recommendationRunId, newRecommendations } = input;
  const count = newRecommendations.length;

  if (!enabled || count === 0) {
    await prisma.notificationDelivery.create({
      data: {
        channel: enabled ? channel.toUpperCase() : "NONE",
        status: "SKIPPED",
        windowHours,
        recommendationCount: count,
        messagePreview: count === 0 ? "No new recommendations" : "Notifications disabled",
        recommendationRunId: recommendationRunId ?? null,
      },
    });
    return;
  }

  const htmlMessage = buildMessage(input);
  const plainMessage = buildPlainMessage(input);
  const preview = plainMessage.split("\n")[0].slice(0, 200);

  try {
    if (channel === "telegram") {
      await sendTelegram(htmlMessage);
    } else if (channel === "discord") {
      await sendDiscord(plainMessage);
    } else if (channel === "slack") {
      await sendSlack(plainMessage);
    } else {
      throw new Error(`Unknown channel: ${channel}`);
    }

    await prisma.notificationDelivery.create({
      data: {
        channel: channel.toUpperCase(),
        status: "SENT",
        windowHours,
        recommendationCount: count,
        messagePreview: preview,
        sentAt: new Date(),
        recommendationRunId: recommendationRunId ?? null,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[notifications] Send failed (${channel}):`, errorMessage);

    await prisma.notificationDelivery.create({
      data: {
        channel: channel.toUpperCase(),
        status: "FAILED",
        windowHours,
        recommendationCount: count,
        messagePreview: preview,
        errorMessage: errorMessage.slice(0, 1000),
        recommendationRunId: recommendationRunId ?? null,
      },
    });
  }
}
