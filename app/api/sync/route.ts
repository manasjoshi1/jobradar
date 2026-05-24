/**
 * GET /api/sync  (legacy — synchronous, waits for completion)
 * POST /api/sync (legacy — synchronous, waits for completion)
 *
 * For non-blocking sync prefer:
 *   POST /api/sync/start  → returns { runId }
 *   GET  /api/sync/status?runId=<id> → poll for progress
 */
import { NextResponse } from "next/server";
import { recoverAbandonedRuns } from "@/lib/services/run-recovery-service";
import { runSync } from "@/lib/services/sync-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return syncJobs();
}

export async function POST() {
  return syncJobs();
}

async function syncJobs() {
  await recoverAbandonedRuns(30);
  try {
    const result = await runSync();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
