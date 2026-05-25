/**
 * POST /api/cron/hourly
 *
 * Requires header: Authorization: Bearer <CRON_SECRET>
 *
 * Runs sync + recommendation in sequence.
 * Can be triggered externally (Vercel cron, cron job, etc.)
 * or manually for testing.
 *
 * Uses the same sync-service used by /api/sync/start so source resolution
 * is consistent (no silent global fallback).
 */
import { NextResponse, type NextRequest } from "next/server";
import { runRecommendations } from "@/lib/services/recommendation-service";
import { runSync } from "@/lib/services/sync-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    console.log("[cron/hourly] Starting hourly sync + recommendations");

    const syncResult = await runSync();
    console.log("[cron/hourly] Sync complete:", {
      sourcesProcessed: syncResult.sourcesProcessed,
      jobsCreated:      syncResult.jobsCreated,
      noSources:        syncResult.noSources ?? false,
      reason:           syncResult.reason,
    });

    // Run recommendations regardless of sync result — even if sync was skipped,
    // existing jobs in DB may still produce new recommendations.
    const recResult = await runRecommendations(1);
    console.log("[cron/hourly] Recommendations complete:", recResult);

    return NextResponse.json({
      sync:            syncResult,
      recommendations: recResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron run failed";
    console.error("[cron/hourly] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
