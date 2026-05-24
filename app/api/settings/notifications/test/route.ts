/**
 * POST /api/settings/notifications/test
 *
 * Sends a test notification using the current configuration.
 * Uses the real notification service but with a synthetic test payload
 * (does not create recommendation rows or mark notifiedAt).
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getChannel(body: { channel?: string }) {
  const override = body.channel?.toUpperCase();
  if (override) return override.toLowerCase();
  return (process.env.NOTIFICATION_CHANNEL ?? "slack").toLowerCase();
}

export async function POST(request: NextRequest) {
  let body: { channel?: string } = {};
  try { body = await request.json() as { channel?: string }; } catch { /* ignore */ }

  const channel = await getChannel(body);
  const appUrl  = process.env.APP_PUBLIC_URL ?? "http://localhost:3000";

  // Resolve credentials from DB pref → env fallback
  let webhookUrl   = "";
  let tgToken      = "";
  let tgChatId     = "";

  try {
    const user = await prisma.user.findFirst({ where: { isDefault: true } });
    if (user) {
      const pref = await prisma.userNotificationPreference.findFirst({
        where: { userId: user.id, channel: channel.toUpperCase() },
      });
      if (pref) {
        webhookUrl = pref.slackWebhookUrl   ?? pref.discordWebhookUrl ?? "";
        tgToken    = pref.telegramBotToken  ?? "";
        tgChatId   = pref.telegramChatId    ?? "";
      }
    }
  } catch { /* DB not ready */ }

  // Env fallback
  if (!webhookUrl && !tgToken) {
    webhookUrl = process.env.SLACK_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL ?? "";
    tgToken    = process.env.TELEGRAM_BOT_TOKEN ?? "";
    tgChatId   = process.env.TELEGRAM_CHAT_ID  ?? "";
  }

  const testMessage = `🧪 *JobRadar test notification*\nChannel: ${channel.toUpperCase()}\nOpen: ${appUrl}`;

  try {
    if (channel === "slack") {
      if (!webhookUrl) return NextResponse.json({ error: "SLACK_WEBHOOK_URL not configured" }, { status: 400 });
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testMessage }),
      });
      if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
    } else if (channel === "telegram") {
      if (!tgToken || !tgChatId) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN/CHAT_ID not configured" }, { status: 400 });
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChatId, text: testMessage }),
      });
      if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
    } else if (channel === "discord") {
      if (!webhookUrl) return NextResponse.json({ error: "DISCORD_WEBHOOK_URL not configured" }, { status: 400 });
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: testMessage }),
      });
      if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
    } else {
      return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, channel, message: "Test notification sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
