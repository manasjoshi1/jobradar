/**
 * GET  /api/profile/role-profiles  — list all user role profiles
 * POST /api/profile/role-profiles  — create new role profile
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

export async function GET() {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profiles = await prisma.userRoleProfile.findMany({
    where: { userId },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ profiles: profiles.map(formatProfile) });
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

  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  // Check for existing profile with same name
  const existing = await prisma.userRoleProfile.findUnique({
    where: { userId_name: { userId, name } },
  });
  if (existing) {
    return NextResponse.json({ error: `Profile "${name}" already exists` }, { status: 409 });
  }

  function toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    return [];
  }

  const profile = await prisma.userRoleProfile.create({
    data: {
      userId,
      name,
      enabled: body.enabled !== false,
      priority: typeof body.priority === "number" ? body.priority : 0,
      minScore: typeof body.minScore === "number" ? body.minScore : 50,
      requiresSponsorship: Boolean(body.requiresSponsorship ?? false),
      preferredTitles: JSON.stringify(toStringArray(body.preferredTitles)),
      preferredLocations: JSON.stringify(toStringArray(body.preferredLocations)),
      mustHaveKeywords: JSON.stringify(toStringArray(body.mustHaveKeywords)),
      niceHaveKeywords: JSON.stringify(toStringArray(body.niceHaveKeywords)),
      negativeKeywords: JSON.stringify(toStringArray(body.negativeKeywords)),
    },
  });

  return NextResponse.json(formatProfile(profile), { status: 201 });
}
