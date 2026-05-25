import { NextResponse, type NextRequest } from "next/server";
import { runUserRecommendations } from "@/lib/services/user-recommendation-service";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { windowHours?: number };
    // windowHours = 0 means "scan all jobs" (full backfill, no time filter).
    // Otherwise clamp to [1, 8760] and default to 48h.
    const raw = Number(body.windowHours);
    const windowHours = raw === 0 ? 0 : Math.min(Math.max(1, raw || 48), 8760);

    // Always use the session user — never accept userId from client
    const userId = await getSessionUserId();
    const result = await runUserRecommendations(userId, windowHours);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recommendation run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
