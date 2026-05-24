/**
 * GET  /api/settings/notifications  — return current notification preferences
 * POST /api/settings/notifications  — update preferences
 *
 * Secrets (webhooks, tokens) are masked in GET responses.
 * Full values are accepted in POST but never returned.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CHANNELS = ["SLACK", "TELEGRAM", "DISCORD"] as const;
type Channel = typeof CHANNELS[number];

function mask(val: string | null | undefined): string | null {
  if (!val) return null;
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••" + val.slice(-4);
}

/** Get or create the default user */
async function getOrCreateDefaultUser() {
  const existing = await prisma.user.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  return prisma.user.create({ data: { name: "Default User", isDefault: true } });
}

export async function GET() {
  const user = await getOrCreateDefaultUser();

  const prefs = await prisma.userNotificationPreference.findMany({
    where: { userId: user.id },
    orderBy: { channel: "asc" },
  });

  // Also read env vars as fallback values (masked)
  const envSlack    = process.env.SLACK_WEBHOOK_URL;
  const envTgToken  = process.env.TELEGRAM_BOT_TOKEN;
  const envTgChat   = process.env.TELEGRAM_CHAT_ID;
  const envDiscord  = process.env.DISCORD_WEBHOOK_URL;
  const envChannel  = (process.env.NOTIFICATION_CHANNEL ?? "slack").toUpperCase();
  const envEnabled  = process.env.NOTIFICATIONS_ENABLED === "true";

  const result = CHANNELS.map((channel) => {
    const pref = prefs.find((p) => p.channel === channel);
    return {
      channel,
      enabled:          pref?.enabled ?? (envEnabled && envChannel === channel),
      lookbackHours:    pref?.lookbackHours ?? 24,
      maxJobs:          pref?.maxJobs ?? 10,
      maxJobsPerCompany: pref?.maxJobsPerCompany ?? 2,
      // Masked secrets
      slackWebhookUrl:   mask(pref?.slackWebhookUrl ?? (channel === "SLACK"     ? envSlack   : null)),
      telegramBotToken:  mask(pref?.telegramBotToken ?? (channel === "TELEGRAM" ? envTgToken : null)),
      telegramChatId:    mask(pref?.telegramChatId   ?? (channel === "TELEGRAM" ? envTgChat  : null)),
      discordWebhookUrl: mask(pref?.discordWebhookUrl ?? (channel === "DISCORD" ? envDiscord : null)),
      // Whether the value comes from DB (can be updated) or env only
      source: pref ? "db" : "env",
    };
  });

  return NextResponse.json({ user: { id: user.id, name: user.name }, preferences: result });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const channel = (body.channel as string | undefined)?.toUpperCase() as Channel | undefined;
  if (!channel || !CHANNELS.includes(channel)) {
    return NextResponse.json({ error: `channel must be one of ${CHANNELS.join(", ")}` }, { status: 400 });
  }

  const user = await getOrCreateDefaultUser();

  // Build update data — only include fields that were explicitly provided
  type PrefData = {
    enabled?: boolean;
    lookbackHours?: number;
    maxJobs?: number;
    maxJobsPerCompany?: number;
    slackWebhookUrl?: string;
    telegramBotToken?: string;
    telegramChatId?: string;
    discordWebhookUrl?: string;
  };
  const data: PrefData = {};

  if (typeof body.enabled          === "boolean") data.enabled          = body.enabled;
  if (typeof body.lookbackHours    === "number")  data.lookbackHours    = body.lookbackHours;
  if (typeof body.maxJobs          === "number")  data.maxJobs          = body.maxJobs;
  if (typeof body.maxJobsPerCompany === "number") data.maxJobsPerCompany = body.maxJobsPerCompany;

  // Only update secret fields if they're non-empty and not the masked placeholder
  const isMasked = (v: unknown): boolean =>
    typeof v === "string" && (v.includes("••••") || v === "");

  if (typeof body.slackWebhookUrl   === "string" && !isMasked(body.slackWebhookUrl))
    data.slackWebhookUrl = body.slackWebhookUrl;
  if (typeof body.telegramBotToken  === "string" && !isMasked(body.telegramBotToken))
    data.telegramBotToken = body.telegramBotToken;
  if (typeof body.telegramChatId    === "string" && !isMasked(body.telegramChatId))
    data.telegramChatId = body.telegramChatId;
  if (typeof body.discordWebhookUrl === "string" && !isMasked(body.discordWebhookUrl))
    data.discordWebhookUrl = body.discordWebhookUrl;

  await prisma.userNotificationPreference.upsert({
    where:  { userId_channel: { userId: user.id, channel } },
    update: data,
    create: { userId: user.id, channel, ...data },
  });

  return NextResponse.json({ ok: true, channel });
}
