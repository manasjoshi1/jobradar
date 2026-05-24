import { NextResponse, type NextRequest } from "next/server";
import { runUserRecommendations, getDefaultUserId } from "@/lib/services/user-recommendation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { windowHours?: number; userId?: string };
    const windowHours = Math.min(
      Math.max(1, Number(body.windowHours) || 1),
      168,
    );
    const userId = body.userId ?? (await getDefaultUserId());
    const result = await runUserRecommendations(userId, windowHours);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recommendation run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
