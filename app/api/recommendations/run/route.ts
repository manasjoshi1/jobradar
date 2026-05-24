import { NextResponse, type NextRequest } from "next/server";
import { runUserRecommendations } from "@/lib/services/user-recommendation-service";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { windowHours?: number };
    const windowHours = Math.min(Math.max(1, Number(body.windowHours) || 1), 168);

    // Always use the session user — never accept userId from client
    const userId = await getSessionUserId();
    const result = await runUserRecommendations(userId, windowHours);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recommendation run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
