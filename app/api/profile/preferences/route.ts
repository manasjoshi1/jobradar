/**
 * GET  /api/profile/preferences  — return current preferences
 * PATCH /api/profile/preferences  — update preferences
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

function safeJson(val: string | null | undefined): string[] {
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

function formatPrefs(prefs: {
  id: string; userId: string;
  targetLocations: string | null; targetRoles: string | null;
  blockedCompanies: string | null; preferredCompanies: string | null;
  minScore: number; requiresSponsorship: boolean;
  useGlobalDefaultSources: boolean;
}) {
  return {
    id: prefs.id,
    userId: prefs.userId,
    targetLocations: safeJson(prefs.targetLocations),
    targetRoles: safeJson(prefs.targetRoles),
    blockedCompanies: safeJson(prefs.blockedCompanies),
    preferredCompanies: safeJson(prefs.preferredCompanies),
    minScore: prefs.minScore,
    requiresSponsorship: prefs.requiresSponsorship,
    useGlobalDefaultSources: prefs.useGlobalDefaultSources,
  };
}

export async function GET() {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await prisma.userJobPreference.findUnique({ where: { userId } });
  if (!prefs) {
    return NextResponse.json({
      id: null, userId,
      targetLocations: [], targetRoles: [],
      blockedCompanies: [], preferredCompanies: [],
      minScore: 45, requiresSponsorship: false,
    });
  }
  return NextResponse.json(formatPrefs(prefs));
}

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate and build update data
  const data: {
    targetLocations?: string; targetRoles?: string;
    blockedCompanies?: string; preferredCompanies?: string;
    minScore?: number; requiresSponsorship?: boolean;
  } = {};

  if ("targetLocations" in body) {
    if (!Array.isArray(body.targetLocations) || !(body.targetLocations as unknown[]).every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "targetLocations must be string[]" }, { status: 400 });
    }
    data.targetLocations = JSON.stringify(body.targetLocations as string[]);
  }
  if ("targetRoles" in body) {
    if (!Array.isArray(body.targetRoles) || !(body.targetRoles as unknown[]).every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "targetRoles must be string[]" }, { status: 400 });
    }
    data.targetRoles = JSON.stringify(body.targetRoles as string[]);
  }
  if ("blockedCompanies" in body) {
    if (!Array.isArray(body.blockedCompanies) || !(body.blockedCompanies as unknown[]).every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "blockedCompanies must be string[]" }, { status: 400 });
    }
    data.blockedCompanies = JSON.stringify(body.blockedCompanies as string[]);
  }
  if ("preferredCompanies" in body) {
    if (!Array.isArray(body.preferredCompanies) || !(body.preferredCompanies as unknown[]).every((v) => typeof v === "string")) {
      return NextResponse.json({ error: "preferredCompanies must be string[]" }, { status: 400 });
    }
    data.preferredCompanies = JSON.stringify(body.preferredCompanies as string[]);
  }
  if ("minScore" in body) {
    if (typeof body.minScore !== "number") {
      return NextResponse.json({ error: "minScore must be a number" }, { status: 400 });
    }
    data.minScore = Math.max(0, Math.min(100, body.minScore));
  }
  if ("requiresSponsorship" in body) {
    if (typeof body.requiresSponsorship !== "boolean") {
      return NextResponse.json({ error: "requiresSponsorship must be boolean" }, { status: 400 });
    }
    data.requiresSponsorship = body.requiresSponsorship;
  }

  const extData = data as typeof data & { useGlobalDefaultSources?: boolean };
  if ("useGlobalDefaultSources" in body) {
    if (typeof body.useGlobalDefaultSources !== "boolean") {
      return NextResponse.json({ error: "useGlobalDefaultSources must be boolean" }, { status: 400 });
    }
    extData.useGlobalDefaultSources = body.useGlobalDefaultSources as boolean;
  }

  const updated = await prisma.userJobPreference.upsert({
    where: { userId },
    create: { userId, minScore: 45, ...extData },
    update: extData,
  });

  return NextResponse.json(formatPrefs(updated));
}
