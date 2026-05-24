/**
 * GET /api/sync/status?runId=<id>
 *
 * Returns the current state of a SyncRun for live-progress polling.
 * Also returns sourcesProcessed so the UI can show a progress bar.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const run = await prisma.syncRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      sourcesProcessed: true,
      sourcesSucceeded: true,
      sourcesFailed: true,
      jobsCreated: true,
      jobsUpdated: true,
      jobsMarkedStale: true,
      errorSummary: true,
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const durationMs = run.finishedAt
    ? run.finishedAt.getTime() - run.startedAt.getTime()
    : Date.now() - run.startedAt.getTime();

  return NextResponse.json({ ...run, durationMs });
}
