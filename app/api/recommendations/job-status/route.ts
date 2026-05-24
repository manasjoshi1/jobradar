/**
 * PATCH /api/recommendations/job-status
 *
 * Applies a status to ALL UserJobRecommendation rows for a given jobId (for default user).
 * Also upserts UserJobStatus so the per-user job status is tracked separately.
 *
 * Body: { jobId: string, status: RecStatus }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

type RecStatus = "UNSEEN" | "SEEN" | "SAVED" | "APPLIED" | "SKIPPED";
const VALID = new Set<RecStatus>(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

export async function PATCH(request: NextRequest) {
  let jobId: string, status: RecStatus;
  try {
    const body = await request.json() as { jobId?: unknown; status?: unknown };
    if (!body.jobId || typeof body.jobId !== "string") {
      return NextResponse.json({ error: "jobId required" }, { status: 400 });
    }
    if (!body.status || !VALID.has(body.status as RecStatus)) {
      return NextResponse.json({ error: `status must be one of ${[...VALID].join(", ")}` }, { status: 400 });
    }
    jobId  = body.jobId;
    status = body.status as RecStatus;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json({ error: "No default user" }, { status: 500 });
  }

  // Update all user's recommendations for this job
  const result = await prisma.userJobRecommendation.updateMany({
    where: { userId, jobId },
    data:  { status },
  });

  // Upsert UserJobStatus (skip for SEEN/UNSEEN)
  if (status !== "SEEN" && status !== "UNSEEN") {
    await prisma.userJobStatus.upsert({
      where:  { userId_jobId: { userId, jobId } },
      update: {
        status,
        appliedAt: status === "APPLIED" ? new Date() : undefined,
        updatedAt: new Date(),
      },
      create: {
        userId,
        jobId,
        status,
        appliedAt: status === "APPLIED" ? new Date() : null,
      },
    });
  }

  return NextResponse.json({ jobId, status, updated: result.count });
}
