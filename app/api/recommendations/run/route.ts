import { NextResponse, type NextRequest } from "next/server";
import { runRecommendations } from "@/lib/services/recommendation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { windowHours?: number };
    const windowHours = Math.min(
      Math.max(1, Number(body.windowHours) || 1),
      168, // max 7 days
    );

    const result = await runRecommendations(windowHours);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recommendation run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
