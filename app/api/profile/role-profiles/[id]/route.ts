/**
 * PATCH  /api/profile/role-profiles/[id]  — update role profile
 * DELETE /api/profile/role-profiles/[id]  — soft delete (set enabled=false)
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

function safeJson(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

function formatProfile(p: {
  id: string; userId: string; name: string; enabled: boolean; priority: number;
  minScore: number; requiresSponsorship: boolean;
  preferredTitles: string; preferredLocations: string;
  mustHaveKeywords: string; niceHaveKeywords: string; negativeKeywords: string;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    enabled: p.enabled,
    priority: p.priority,
    minScore: p.minScore,
    requiresSponsorship: p.requiresSponsorship,
    preferredTitles: safeJson(p.preferredTitles),
    preferredLocations: safeJson(p.preferredLocations),
    mustHaveKeywords: safeJson(p.mustHaveKeywords),
    niceHaveKeywords: safeJson(p.niceHaveKeywords),
    negativeKeywords: safeJson(p.negativeKeywords),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const profile = await prisma.userRoleProfile.findUnique({ where: { id } });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (profile.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  function toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    return [];
  }

  const data: Record<string, unknown> = {};
  if ("enabled" in body) data.enabled = Boolean(body.enabled);
  if ("priority" in body && typeof body.priority === "number") data.priority = body.priority;
  if ("minScore" in body && typeof body.minScore === "number") data.minScore = body.minScore;
  if ("requiresSponsorship" in body) data.requiresSponsorship = Boolean(body.requiresSponsorship);
  if ("name" in body && typeof body.name === "string") data.name = body.name.trim();
  if ("preferredTitles" in body) data.preferredTitles = JSON.stringify(toStringArray(body.preferredTitles));
  if ("preferredLocations" in body) data.preferredLocations = JSON.stringify(toStringArray(body.preferredLocations));
  if ("mustHaveKeywords" in body) data.mustHaveKeywords = JSON.stringify(toStringArray(body.mustHaveKeywords));
  if ("niceHaveKeywords" in body) data.niceHaveKeywords = JSON.stringify(toStringArray(body.niceHaveKeywords));
  if ("negativeKeywords" in body) data.negativeKeywords = JSON.stringify(toStringArray(body.negativeKeywords));

  const updated = await prisma.userRoleProfile.update({ where: { id }, data });
  return NextResponse.json(formatProfile(updated));
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const profile = await prisma.userRoleProfile.findUnique({ where: { id } });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (profile.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Soft delete — always set enabled=false, never hard-delete
  const updated = await prisma.userRoleProfile.update({
    where: { id },
    data: { enabled: false },
  });
  return NextResponse.json(formatProfile(updated));
}
