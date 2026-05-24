/**
 * PATCH /api/recommendations/job-status
 *
 * Applies a status to ALL recommendation rows for a given jobId.
 * Used by the grouped UI so clicking "Skip" on a grouped job card updates
 * all matched-profile recommendations at once.
 *
 * Body: { jobId: string, status: RecStatus }
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RecStatus = "UNSEEN" | "SEEN" | "SAVED" | "APPLIED" | "SKIPPED";
const VALID = new Set<RecStatus>(["UNSEEN", "SEEN", "SAVED", "APPLIED", "SKIPPED"]);

async function mirrorToJob(jobId: string, status: RecStatus) {
  if (status === "SEEN" || status === "UNSEEN") return;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job || job.status === "APPLIED") return;

  if (status === "APPLIED") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "APPLIED" } });
  } else if (status === "SAVED" && job.status === "NEW") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "SAVED" } });
  } else if (status === "SKIPPED" && (job.status === "NEW" || job.status === "SAVED")) {
    await prisma.job.update({ where: { id: jobId }, data: { status: "SKIPPED" } });
  }
}

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

  const result = await prisma.jobRecommendation.updateMany({
    where: { jobId },
    data: { status },
  });

  await mirrorToJob(jobId, status);

  return NextResponse.json({ jobId, status, updated: result.count });
}
