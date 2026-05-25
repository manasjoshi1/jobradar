/**
 * POST /api/profile/sources/use-global-defaults
 * Body: { enabled: boolean }
 *
 * Enables or disables the "use global default sources" opt-in for the current user.
 *
 * When enabled=true:
 *   - useGlobalDefaultSources is set to true in UserJobPreference
 *   - Sync and recommendations will use all globally enabled JobSource rows
 *     when the user has zero UserJobSource rows
 *
 * When enabled=false:
 *   - useGlobalDefaultSources is set to false
 *   - If user also has no UserJobSource rows, they will see NO_SOURCES_CONFIGURED
 *
 * Returns: { ok, useGlobalDefaultSources, sourceMode, canSync }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";
import { resolveUserSources } from "@/lib/services/source-resolution";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const enabled = body.enabled ?? body.useGlobalDefaultSources;
  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "enabled must be boolean" },
      { status: 400 },
    );
  }

  // Upsert UserJobPreference with new flag
  await prisma.userJobPreference.upsert({
    where:  { userId },
    create: { userId, minScore: 45, useGlobalDefaultSources: enabled },
    update: { useGlobalDefaultSources: enabled },
  });

  // Return updated resolution state
  const resolution = await resolveUserSources(userId);

  return NextResponse.json({
    ok:                      true,
    useGlobalDefaultSources: enabled,
    sourceMode:              resolution.mode,
    canSync:                 resolution.canSync,
    message:                 resolution.message,
  });
}
