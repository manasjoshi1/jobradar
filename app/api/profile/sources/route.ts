/**
 * GET  /api/profile/sources  — list user job sources
 * POST /api/profile/sources  — create/upsert source for session user
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

const PROVIDER_URL_TEMPLATES: Record<string, string> = {
  GREENHOUSE: "https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true",
  LEVER: "https://api.lever.co/v0/postings/{boardToken}",
  ASHBY: "https://api.ashbyhq.com/posting-api/job-board/{boardToken}",
};

function normalizeProvider(raw: string): string {
  const up = (raw ?? "").toUpperCase();
  if (["GREENHOUSE", "LEVER", "ASHBY"].includes(up)) return up;
  return "CUSTOM";
}

function buildUrl(provider: string, boardToken?: string, explicitUrl?: string): string | null {
  if (explicitUrl) return explicitUrl;
  const template = PROVIDER_URL_TEMPLATES[provider];
  if (template && boardToken) return template.replace("{boardToken}", boardToken);
  return null;
}

function safeJson(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

function formatUserSource(us: {
  id: string; userId: string; sourceId: string;
  enabled: boolean; priority: number; tags: string | null;
  createdAt: Date; updatedAt: Date;
  source: {
    id: string; company: string; provider: string; boardToken: string | null;
    url: string; lastSyncAt: Date | null; lastSyncStatus: string | null;
  };
}) {
  return {
    id: us.id,
    userId: us.userId,
    sourceId: us.sourceId,
    enabled: us.enabled,
    priority: us.priority,
    tags: safeJson(us.tags),
    createdAt: us.createdAt,
    updatedAt: us.updatedAt,
    source: {
      id: us.source.id,
      company: us.source.company,
      provider: us.source.provider,
      boardToken: us.source.boardToken,
      url: us.source.url,
      lastSyncAt: us.source.lastSyncAt,
      lastSyncStatus: us.source.lastSyncStatus,
    },
  };
}

export async function GET() {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sources = await prisma.userJobSource.findMany({
    where: { userId },
    include: { source: true },
    orderBy: [{ priority: "desc" }, { source: { company: "asc" } }],
  });

  return NextResponse.json({ sources: sources.map(formatUserSource) });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const company = typeof body.company === "string" ? body.company.trim() : null;
  if (!company) return NextResponse.json({ error: "company is required" }, { status: 400 });

  const provider = normalizeProvider(String(body.provider ?? ""));
  const boardToken = typeof body.boardToken === "string" ? body.boardToken.trim() : undefined;
  const explicitUrl = typeof body.url === "string" ? body.url.trim() : undefined;
  const url = buildUrl(provider, boardToken, explicitUrl);

  if (!url) {
    return NextResponse.json({ error: "Cannot build URL: provide url or boardToken" }, { status: 400 });
  }

  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).map(String) : [];

  // Upsert global JobSource by url
  const jobSource = await prisma.jobSource.upsert({
    where: { url },
    create: {
      company, provider, boardToken: boardToken ?? null, url,
      enabled: body.enabled !== false,
      priority: typeof body.priority === "number" ? body.priority : 0,
      tags: JSON.stringify(tags),
    },
    update: {
      company, provider, boardToken: boardToken ?? null,
      enabled: body.enabled !== false,
      priority: typeof body.priority === "number" ? body.priority : 0,
      tags: JSON.stringify(tags),
    },
  });

  // Upsert UserJobSource for session user
  const userSource = await prisma.userJobSource.upsert({
    where: { userId_sourceId: { userId, sourceId: jobSource.id } },
    create: {
      userId, sourceId: jobSource.id,
      enabled: body.enabled !== false,
      priority: typeof body.priority === "number" ? body.priority : 0,
      tags: JSON.stringify(tags),
    },
    update: {
      enabled: body.enabled !== false,
      priority: typeof body.priority === "number" ? body.priority : 0,
      tags: JSON.stringify(tags),
    },
    include: { source: true },
  });

  return NextResponse.json(formatUserSource(userSource), { status: 201 });
}
