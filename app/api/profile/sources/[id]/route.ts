/**
 * PATCH  /api/profile/sources/[id]  — update UserJobSource
 * DELETE /api/profile/sources/[id]  — soft disable
 *
 * [id] = UserJobSource.id (not JobSource.id)
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

function safeJson(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const userSource = await prisma.userJobSource.findUnique({
    where: { id },
    include: { source: true },
  });
  if (!userSource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (userSource.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if ("enabled" in body) data.enabled = Boolean(body.enabled);
  if ("priority" in body && typeof body.priority === "number") data.priority = body.priority;
  if ("tags" in body) {
    const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).map(String) : [];
    data.tags = JSON.stringify(tags);
  }

  const updated = await prisma.userJobSource.update({
    where: { id },
    data,
    include: { source: true },
  });

  return NextResponse.json({
    id: updated.id,
    userId: updated.userId,
    sourceId: updated.sourceId,
    enabled: updated.enabled,
    priority: updated.priority,
    tags: safeJson(updated.tags),
    source: {
      id: updated.source.id,
      company: updated.source.company,
      provider: updated.source.provider,
      boardToken: updated.source.boardToken,
      url: updated.source.url,
      lastSyncAt: updated.source.lastSyncAt,
      lastSyncStatus: updated.source.lastSyncStatus,
    },
  });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const userSource = await prisma.userJobSource.findUnique({ where: { id } });
  if (!userSource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (userSource.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.userJobSource.update({ where: { id }, data: { enabled: false } });
  return NextResponse.json({ ok: true, id, enabled: false });
}
