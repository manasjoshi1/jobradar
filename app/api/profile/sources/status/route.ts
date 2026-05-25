/**
 * GET /api/profile/sources/status
 *
 * Returns the current user's source resolution state.
 * Frontend uses this to render the empty state / global-defaults badge.
 *
 * Response:
 * {
 *   sourceMode: "profile" | "global_defaults" | "none",
 *   useGlobalDefaultSources: boolean,
 *   profileSourceCount: number,
 *   globalSourceCount: number,
 *   canSync: boolean,
 *   reason: "NO_SOURCES_CONFIGURED" | null,
 *   message: string | null,
 *   actions: string[]   // suggested UI actions when canSync=false
 * }
 */
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-user-id";
import { resolveUserSources } from "@/lib/services/source-resolution";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resolution = await resolveUserSources(userId);

  const actions: string[] = [];
  if (!resolution.canSync) {
    actions.push("upload_sources");
    if (resolution.globalSourceCount > 0) {
      actions.push("use_global_defaults");
    }
  }

  return NextResponse.json({
    sourceMode:              resolution.mode,
    useGlobalDefaultSources: resolution.useGlobalDefaultSources,
    profileSourceCount:      resolution.profileSourceCount,
    globalSourceCount:       resolution.globalSourceCount,
    canSync:                 resolution.canSync,
    reason:                  resolution.reason,
    message:                 resolution.message,
    actions,
  });
}
